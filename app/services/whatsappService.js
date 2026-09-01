const fs = require("fs/promises");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { createWhatsAppInjectionHelpers } = require("./whatsappInjectionService");
const {
  getSessionId,
  getLocalAuthClientId,
  getLocalAuthDataPath,
  getLocalAuthSessionPath,
  getChromeExecutablePath,
  getChromeExecutableDiagnostics,
  getClientState,
  isWhatsAppClientUsable,
  isPuppeteerTargetClosedError,
  isPuppeteerNavigationError,
  withTimeout,
  normalizeSerializedWid,
  isLikelyUserWid,
} = require("./whatsappRuntimeUtils");
const qrcode = require("qrcode-terminal");
const WhatsAppSession = require("../models/WhatsAppSession");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const logger = require("../utils/logger");
const { trace } = require("../utils/trace");

const clients = new Map();
const readyWaiters = new Map();
const initializingClients = new Map();
const cleanupClients = new Map();

const updateMessageAck = async (message, ack) => {
  if (!message?.id?._serialized) {
    return;
  }

  trace("whatsapp.message_ack", {
    providerMessageId: message.id._serialized,
    ack,
  });

  const statusByAck = {
    "-1": "failed",
    0: "pending",
    1: "sent",
    2: "delivered",
    3: "read",
    4: "played",
  };

  await WhatsAppMessage.update(
    {
      providerMessageId: message.id._serialized,
      status: statusByAck[ack] || "unknown",
      deliveredAt: ack >= 2 ? new Date() : undefined,
      readAt: ack >= 3 ? new Date() : undefined,
    },
    {
      where: { providerMessageId: message.id._serialized },
    }
  );
};

const markSessionReady = async (userId, sessionId, whatsapp) => {
  trace("whatsapp.session.mark_ready.before", {
    userId,
    sessionId,
    hasInfo: Boolean(whatsapp?.info),
  });

  await WhatsAppSession.update(
    { status: "ready", qrCode: null, lastActive: new Date() },
    { where: { userId, sessionId } }
  );
  logger.info(`WhatsApp client ready for user ${userId}`);
  const waiters = readyWaiters.get(sessionId) || [];
  waiters.forEach((resolve) => resolve(whatsapp));
  readyWaiters.delete(sessionId);

  trace("whatsapp.session.mark_ready.after", {
    userId,
    sessionId,
    resolvedWaiters: waiters.length,
  });
};

const forceCloseBrowser = async (sessionId, client) => {
  try {
    if (client?.pupPage && !client.pupPage.isClosed()) {
      await client.pupPage.close().catch(() => {});
    }
  } catch (error) {
    trace("whatsapp.browser_force_close.page_error", {
      sessionId,
      error: error.message,
    }, "warn");
  }

  try {
    if (client?.pupBrowser?.isConnected?.()) {
      await client.pupBrowser.close().catch(() => {});
    }
  } catch (error) {
    trace("whatsapp.browser_force_close.browser_error", {
      sessionId,
      error: error.message,
    }, "warn");
  }

  const browserProcess = client?.pupBrowser?.process?.();
  if (browserProcess && !browserProcess.killed) {
    trace("whatsapp.browser_force_close.kill_process", {
      sessionId,
      pid: browserProcess.pid,
    }, "warn");
    browserProcess.kill("SIGKILL");
  }
};

const cleanupWhatsAppClient = async (sessionId, client, status = "disconnected") => {
  if (cleanupClients.has(sessionId)) {
    trace("whatsapp.client.cleanup.await_existing", { sessionId, status });
    return cleanupClients.get(sessionId);
  }

  const cleanupPromise = (async () => {
    trace("whatsapp.client.cleanup.start", {
      sessionId,
      status,
      wasCurrentClient: clients.get(sessionId) === client,
      hasPage: Boolean(client?.pupPage),
      pageClosed: client?.pupPage ? client.pupPage.isClosed() : null,
    });

    if (clients.get(sessionId) === client) {
      clients.delete(sessionId);
    }
    readyWaiters.delete(sessionId);

    const destroyPromise = Promise.resolve(client?.destroy?.()).catch((error) => {
      logger.warn(`WhatsApp client cleanup warning for ${sessionId}: ${error.message}`);
      trace("whatsapp.client.cleanup.destroy_error", {
        sessionId,
        error: error.message,
        code: error.code || null,
      }, "warn");
      return null;
    });

    await withTimeout(destroyPromise, 5000, null);
    await forceCloseBrowser(sessionId, client);

    await WhatsAppSession.update(
      { status, lastActive: new Date() },
      { where: { sessionId } }
    );

    trace("whatsapp.client.cleanup.done", {
      sessionId,
      status,
    });
  })();

  cleanupClients.set(sessionId, cleanupPromise);

  try {
    return await cleanupPromise;
  } finally {
    cleanupClients.delete(sessionId);
  }
};

const {
  hasSendMessageHelper,
  isWhatsAppClientReady,
  prepareWhatsAppForMessage,
} = createWhatsAppInjectionHelpers({
  cleanupWhatsAppClient,
  getClientState,
  isWhatsAppClientUsable,
  isPuppeteerTargetClosedError,
  withTimeout,
  normalizeSerializedWid,
  isLikelyUserWid,
});

const initializeWhatsApp = async (userId, phone) => {
  const sessionId = getSessionId(userId, phone);

  if (initializingClients.has(sessionId)) {
    trace("whatsapp.initialize.await_existing", {
      userId,
      phone,
      sessionId,
    });
    return initializingClients.get(sessionId);
  }

  if (clients.has(sessionId)) {
    trace("whatsapp.initialize.reuse_client", {
      userId,
      phone,
      sessionId,
      hasInfo: Boolean(clients.get(sessionId)?.info),
    });
    return clients.get(sessionId);
  }

  trace("whatsapp.initialize.start", {
    userId,
    phone,
    sessionId,
    localAuthClientId: getLocalAuthClientId(sessionId),
    chromeExecutablePath: getChromeExecutablePath() || null,
    chromeExecutableDiagnostics: getChromeExecutableDiagnostics(),
  });

  const savedSession = await WhatsAppSession.findOne({
    where: {
      userId,
      sessionId,
    },
  });

  const whatsapp = new Client({
    authStrategy: new LocalAuth({
      clientId: getLocalAuthClientId(sessionId),
      dataPath: getLocalAuthDataPath(),
    }),
    puppeteer: {
      headless: true,
      executablePath: getChromeExecutablePath(),
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-breakpad",
        "--disable-crash-reporter",
        "--disable-crashpad",
        "--disable-features=Crashpad",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-software-rasterizer",
        "--no-first-run",
        "--no-zygote",
      ],
    },
  });

  clients.set(sessionId, whatsapp);
  trace("whatsapp.initialize.client_created", {
    userId,
    phone,
    sessionId,
  });

  whatsapp.on("qr", async (qr) => {
    trace("whatsapp.event.qr", {
      userId,
      phone,
      sessionId,
      qrLength: qr?.length || 0,
    });
    qrcode.generate(qr, { small: true });
    await WhatsAppSession.upsert({
      userId,
      sessionId,
      phone,
      qrCode: qr,
      status: "pending",
    });
  });

  whatsapp.on("loading_screen", (percent, message) => {
    trace("whatsapp.event.loading_screen", {
      userId,
      phone,
      sessionId,
      percent,
      message,
    });
    logger.info(`WhatsApp loading ${percent}% for ${sessionId}: ${message}`);
  });

  whatsapp.on("authenticated", async (session) => {
    trace("whatsapp.event.authenticated", {
      userId,
      phone,
      sessionId,
      hasSessionPayload: Boolean(session),
    });
    await WhatsAppSession.upsert({
      userId,
      sessionId,
      phone,
      sessionData: session || savedSession?.sessionData || null,
      qrCode: null,
      status: "authenticated",
    });
  });

  whatsapp.on("auth_failure", async (message) => {
    trace("whatsapp.event.auth_failure", {
      userId,
      phone,
      sessionId,
      message,
    }, "error");
    await WhatsAppSession.update(
      { status: "auth_failure", lastActive: new Date() },
      { where: { userId, sessionId } }
    );
    logger.error(`WhatsApp auth failure for ${sessionId}: ${message}`);
  });

  whatsapp.on("change_state", async (state) => {
    trace("whatsapp.event.change_state", {
      userId,
      phone,
      sessionId,
      state,
    });
    logger.info(`WhatsApp state changed for ${sessionId}: ${state}`);
  });

  whatsapp.on("ready", async () => {
    trace("whatsapp.event.ready", {
      userId,
      phone,
      sessionId,
    });
    await markSessionReady(userId, sessionId, whatsapp);
  });

  whatsapp.on("message_ack", updateMessageAck);

  whatsapp.on("disconnected", async () => {
    trace("whatsapp.event.disconnected", {
      userId,
      phone,
      sessionId,
    }, "warn");
    await cleanupWhatsAppClient(sessionId, whatsapp);
  });

  try {
    trace("whatsapp.initialize.before_initialize", {
      userId,
      phone,
      sessionId,
    });
    const initializeWithRetry = async () => {
      let lastError;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          trace("whatsapp.initialize.attempt", {
            userId,
            phone,
            sessionId,
            attempt,
          });

          const result = await withTimeout(
            whatsapp.initialize().then(() => whatsapp),
            45000,
            null
          );

          if (!result) {
            const error = new Error("WhatsApp initialization timed out before QR or ready state.");
            error.statusCode = 400;
            throw error;
          }

          return result;
        } catch (error) {
          lastError = error;
          if (!isPuppeteerNavigationError(error) || attempt === 2) {
            throw error;
          }

          trace("whatsapp.initialize.retry_navigation", {
            userId,
            phone,
            sessionId,
            attempt,
            error: error.message,
          }, "warn");
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }

      throw lastError;
    };

    const initializationPromise = initializeWithRetry();
    initializingClients.set(sessionId, initializationPromise);
    await initializationPromise;
    trace("whatsapp.initialize.after_initialize", {
      userId,
      phone,
      sessionId,
      hasPage: Boolean(whatsapp.pupPage),
      hasBrowser: Boolean(whatsapp.pupBrowser),
    });
    whatsapp.pupPage?.on("close", () => {
      trace("whatsapp.event.page_close", {
        userId,
        phone,
        sessionId,
      }, "warn");
      cleanupWhatsAppClient(sessionId, whatsapp).catch((error) => {
        logger.warn(`WhatsApp page close cleanup failed for ${sessionId}: ${error.message}`);
      });
    });
    whatsapp.pupBrowser?.on("disconnected", () => {
      trace("whatsapp.event.browser_disconnected", {
        userId,
        phone,
        sessionId,
      }, "warn");
      cleanupWhatsAppClient(sessionId, whatsapp).catch((error) => {
        logger.warn(`WhatsApp browser disconnect cleanup failed for ${sessionId}: ${error.message}`);
      });
    });
    if (await isWhatsAppClientReady(whatsapp, sessionId, phone)) {
      await markSessionReady(userId, sessionId, whatsapp);
    }
    trace("whatsapp.initialize.return", {
      userId,
      phone,
      sessionId,
      hasInfo: Boolean(whatsapp.info),
      clientUsable: isWhatsAppClientUsable(whatsapp),
    });
    return whatsapp;
  } catch (err) {
    clients.delete(sessionId);
    readyWaiters.delete(sessionId);
    logger.error(`WhatsApp initialization error: ${err}`);
    trace("whatsapp.initialize.error", {
      userId,
      phone,
      sessionId,
      error: err.message,
      chromeExecutablePath: getChromeExecutablePath() || null,
      chromeExecutableDiagnostics: getChromeExecutableDiagnostics(),
    }, "error");
    if (err.message?.includes("Failed to launch the browser process")) {
      err.statusCode = 400;
      err.message =
        "Chrome or Edge could not be launched for WhatsApp. Set CHROME_EXECUTABLE_PATH in .env.";
    }
    throw err;
  } finally {
    initializingClients.delete(sessionId);
  }
};

const getWhatsAppClient = (userId, phone) => clients.get(getSessionId(userId, phone));

const isWhatsAppInitializing = (userId, phone) =>
  initializingClients.has(getSessionId(userId, phone));

const getWhatsAppRuntimeStatus = async (userId, phone) => {
  const sessionId = getSessionId(userId, phone);
  const client = clients.get(sessionId);
  const state = client ? await getClientState(client) : null;
  const hasSendMessage = client ? await hasSendMessageHelper(client) : false;

  const runtime = {
    hasClient: Boolean(client),
    hasInfo: Boolean(client?.info),
    hasPage: Boolean(client?.pupPage),
    pageClosed: client?.pupPage ? client.pupPage.isClosed() : null,
    browserConnected:
      typeof client?.pupBrowser?.isConnected === "function"
        ? client.pupBrowser.isConnected()
        : null,
    hasSendMessage,
    state,
  };

  trace("whatsapp.runtime_status", {
    userId,
    phone,
    sessionId,
    runtime,
  });

  return runtime;
};

const waitForWhatsAppReady = async (userId, phone, timeoutMs = 60000) => {
  const sessionId = getSessionId(userId, phone);
  let whatsapp = clients.get(sessionId);

  trace("whatsapp.wait_ready.start", {
    userId,
    phone,
    sessionId,
    timeoutMs,
    hasClient: Boolean(whatsapp),
  });

  if (whatsapp && !isWhatsAppClientUsable(whatsapp)) {
    logger.warn(`WhatsApp client page is closed for ${sessionId}; restarting client.`);
    await cleanupWhatsAppClient(sessionId, whatsapp);
    whatsapp = null;
  }

  if (!whatsapp) {
    trace("whatsapp.wait_ready.initialize_missing_client", {
      userId,
      phone,
      sessionId,
    });
    whatsapp = await initializeWhatsApp(userId, phone);
  }

  if (await isWhatsAppClientReady(whatsapp, sessionId, phone)) {
    trace("whatsapp.wait_ready.immediate_ready", {
      userId,
      phone,
      sessionId,
    });
    return whatsapp;
  }

  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      if (!isWhatsAppClientUsable(whatsapp)) {
        clearInterval(interval);
        clearTimeout(timeout);
        cleanupWhatsAppClient(sessionId, whatsapp).finally(async () => {
          try {
            const restarted = await initializeWhatsApp(userId, phone);
            const ready = await waitForWhatsAppReady(userId, phone, timeoutMs);
            resolve(ready || restarted);
          } catch (error) {
            reject(error);
          }
        });
        return;
      }

      if (await isWhatsAppClientReady(whatsapp, sessionId, phone)) {
        clearInterval(interval);
        clearTimeout(timeout);
        await markSessionReady(userId, sessionId, whatsapp);
        trace("whatsapp.wait_ready.resolved", {
          userId,
          phone,
          sessionId,
        });
        resolve(whatsapp);
      }
    }, 1000);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      const error = new Error(
        "WhatsApp client is not ready yet. Keep the WhatsApp page open until status becomes ready."
      );
      error.statusCode = 400;
      getWhatsAppRuntimeStatus(userId, phone).then((runtime) => {
        trace("whatsapp.wait_ready.timeout", {
          userId,
          phone,
          sessionId,
          runtime,
        }, "warn");
        logger.warn(
          `WhatsApp ready timeout for ${sessionId}: ${JSON.stringify(runtime)}`
        );
      });
      reject(error);
    }, timeoutMs);

    const waiters = readyWaiters.get(sessionId) || [];
    waiters.push((client) => {
      clearTimeout(timeout);
      resolve(client);
    });
    readyWaiters.set(sessionId, waiters);
  });
};

const deleteWhatsAppClient = async (sessionId) => {
  trace("whatsapp.delete_client.start", {
    sessionId,
    hasClient: clients.has(sessionId),
    isInitializing: initializingClients.has(sessionId),
  });
  if (initializingClients.has(sessionId)) {
    trace("whatsapp.delete_client.await_initializing", { sessionId });
    const initialized = await withTimeout(
      initializingClients.get(sessionId)
        .then(() => true)
        .catch((error) => {
          trace("whatsapp.delete_client.initializing_failed", {
            sessionId,
            error: error.message,
          }, "warn");
          return false;
        }),
      2000,
      false
    );

    if (!initialized) {
      trace("whatsapp.delete_client.initializing_timeout", { sessionId }, "warn");
      initializingClients.delete(sessionId);
    }
  }

  if (clients.has(sessionId)) {
    const client = clients.get(sessionId);
    await cleanupWhatsAppClient(sessionId, client);
  }
  trace("whatsapp.delete_client.done", { sessionId });
};

const deleteLocalAuthSession = async (sessionId) => {
  const sessionPath = getLocalAuthSessionPath(sessionId);
  trace("whatsapp.delete_auth.start", {
    sessionId,
    sessionPath,
  });

  const deletePromise = fs
    .rm(sessionPath, {
      recursive: true,
      force: true,
      maxRetries: 2,
      retryDelay: 500,
    })
    .then(() => {
      trace("whatsapp.delete_auth.done", { sessionId });
      return true;
    })
    .catch(async (error) => {
      if (["EPERM", "EBUSY"].includes(error.code)) {
        logger.warn(
          `Could not fully delete WhatsApp auth session ${sessionId}; Chrome still has a file locked: ${error.message}`
        );
        trace("whatsapp.delete_auth.locked", {
          sessionId,
          error: error.message,
          code: error.code,
        }, "warn");

        const pendingDeletePath = `${sessionPath}.delete-pending-${Date.now()}`;
        try {
          await fs.rename(sessionPath, pendingDeletePath);
          trace("whatsapp.delete_auth.renamed_locked_dir", {
            sessionId,
            pendingDeletePath,
          }, "warn");
        } catch (renameError) {
          trace("whatsapp.delete_auth.rename_locked_dir_failed", {
            sessionId,
            error: renameError.message,
            code: renameError.code,
          }, "warn");
        }

        return false;
      }

      throw error;
    });

  return Promise.race([
    deletePromise,
    new Promise((resolve) => {
      setTimeout(() => {
        trace("whatsapp.delete_auth.timeout", {
          sessionId,
          sessionPath,
        }, "warn");
        resolve(false);
      }, 3000);
    }),
  ]);
};

module.exports = {
  initializeWhatsApp,
  getWhatsAppClient,
  getWhatsAppRuntimeStatus,
  waitForWhatsAppReady,
  prepareWhatsAppForMessage,
  deleteWhatsAppClient,
  deleteLocalAuthSession,
  getSessionId,
  isWhatsAppInitializing,
};

