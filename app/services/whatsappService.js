const fs = require("fs/promises");
const path = require("path");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { ClientInfo } = require("whatsapp-web.js/src/structures");
const InterfaceController = require("whatsapp-web.js/src/util/InterfaceController");
const { ExposeStore } = require("whatsapp-web.js/src/util/Injected/Store");
const { LoadUtils } = require("whatsapp-web.js/src/util/Injected/Utils");
const qrcode = require("qrcode-terminal");
const WhatsAppSession = require("../models/WhatsAppSession");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const logger = require("../utils/logger");
const { trace } = require("../utils/trace");

const clients = new Map();
const readyWaiters = new Map();
const initializingClients = new Map();

const getSessionId = (userId, phone) => `${userId}_${phone}`;

const getLocalAuthClientId = (sessionId) =>
  sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");

const getLocalAuthSessionPath = (sessionId) =>
  path.join(
    __dirname,
    "../../.wwebjs_auth",
    `session-${getLocalAuthClientId(sessionId)}`
  );

const getChromeExecutablePath = () => {
  const candidates = [
    process.env.CHROME_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);

  const fs = require("fs");
  return candidates.find((candidate) => fs.existsSync(candidate));
};

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

const getClientState = async (client) => {
  try {
    return await client.getState();
  } catch (error) {
    return null;
  }
};

const isWhatsAppClientUsable = (client) =>
  Boolean(client?.pupPage) &&
  !client.pupPage.isClosed() &&
  (typeof client.pupBrowser?.isConnected !== "function" ||
    client.pupBrowser.isConnected());

const isPuppeteerTargetClosedError = (error) =>
  /Session closed|Target closed|Protocol error/i.test(error?.message || "");

const withTimeout = (promise, timeoutMs, timeoutValue) =>
  Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(timeoutValue), timeoutMs)),
  ]);

const normalizeSerializedWid = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (value._serialized) {
    return value._serialized;
  }

  if (value.user && value.server) {
    return `${value.user}@${value.server}`;
  }

  if (value.user) {
    return `${value.user}@c.us`;
  }

  return null;
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
};

const hasSendMessageHelper = async (client) => {
  if (!isWhatsAppClientUsable(client)) {
    return false;
  }

  try {
    return await client.pupPage?.evaluate(
      () => typeof window.WWebJS?.sendMessage === "function"
    );
  } catch (error) {
    if (isPuppeteerTargetClosedError(error)) {
      return false;
    }
    return false;
  }
};

const patchWhatsAppUserHelpers = async (client, fallbackPhone = null) => {
  if (!isWhatsAppClientUsable(client)) {
    return false;
  }

  try {
    const fallbackWid =
      normalizeSerializedWid(client.info?.wid) ||
      normalizeSerializedWid(client.info?.me) ||
      null;
    const fallbackChatId = fallbackPhone
      ? `${fallbackPhone.toString().replace(/\D/g, "")}@c.us`
      : null;

    trace("whatsapp.helper_patch.fallback", {
      hasFallbackWid: Boolean(fallbackWid),
      fallbackWidServer: fallbackWid?.split("@")[1] || null,
      hasFallbackChatId: Boolean(fallbackChatId),
    });

    return await client.pupPage.evaluate((fallbackChatId, fallbackWid) => {
      const toWid = (value) => {
        if (!value) {
          return null;
        }

        if (value._serialized || (value.user && value.server)) {
          return value;
        }

        if (typeof value === "string") {
          const [user, server = "c.us"] = value.split("@");
          if (!user) {
            return null;
          }

          return {
            user,
            server,
            _serialized: `${user}@${server}`,
            isGroup: () => server === "g.us",
            isUser: () => server === "c.us" || server === "s.whatsapp.net",
          };
        }

        return null;
      };

      const getCurrentWid = () => {
        const userStore = window.Store?.User || {};
        const candidates = [
          userStore.getMaybeMeUser,
          userStore.getMeUser,
          () => window.Store?.Conn?.wid,
          () => window.Store?.Conn?.me,
          () => window.Store?.Conn?.id,
          () => window.AuthStore?.Conn?.wid,
          () => window.AuthStore?.Conn?.me,
          () => window.Store?.Conn?.serialize?.().wid,
          () => window.Store?.Conn?.serialize?.().me,
          () => window.Store?.Conn?.serialize?.().id,
          () => window.AuthStore?.Conn?.serialize?.().wid,
          () => window.AuthStore?.Conn?.serialize?.().me,
          () => window.AuthStore?.Conn?.serialize?.().id,
          () => fallbackWid,
          () => fallbackChatId,
        ];

        for (const getWid of candidates) {
          if (typeof getWid !== "function") {
            continue;
          }

          try {
            const wid = toWid(getWid());
            if (wid) {
              return wid;
            }
          } catch (error) {
            // WhatsApp Web private APIs change often; keep trying fallbacks.
          }
        }

        return null;
      };

      if (!window.Store) {
        return false;
      }

      if (!window.Store.User || Object.isFrozen(window.Store.User)) {
        window.Store.User = { ...(window.Store.User || {}) };
      }

      if (fallbackWid) {
        window.WWebJS = window.WWebJS || {};
        window.WWebJS.meUserWid = fallbackWid;

        const getFallbackWid = () => toWid(fallbackWid);

        try {
          Object.defineProperty(window.Store.User, "getMaybeMeUser", {
            configurable: true,
            writable: true,
            value: getFallbackWid,
          });
        } catch (error) {
          window.Store.User.getMaybeMeUser = getFallbackWid;
        }

        try {
          Object.defineProperty(window.Store.User, "getMeUser", {
            configurable: true,
            writable: true,
            value: getFallbackWid,
          });
        } catch (error) {
          window.Store.User.getMeUser = getFallbackWid;
        }

        return {
          patched: true,
          source: "client.info.wid",
          hasGetMaybeMeUser: true,
          hasGetMeUser: true,
        };
      }

      if (typeof window.Store.User.getMaybeMeUser !== "function") {
        try {
          Object.defineProperty(window.Store.User, "getMaybeMeUser", {
            configurable: true,
            writable: true,
            value: getCurrentWid,
          });
        } catch (error) {
          window.Store.User.getMaybeMeUser = getCurrentWid;
        }
      }

      if (typeof window.Store.User.getMeUser !== "function") {
        try {
          Object.defineProperty(window.Store.User, "getMeUser", {
            configurable: true,
            writable: true,
            value: getCurrentWid,
          });
        } catch (error) {
          window.Store.User.getMeUser = getCurrentWid;
        }
      }

      return {
        patched: Boolean(getCurrentWid()),
        hasGetMaybeMeUser: typeof window.Store.User.getMaybeMeUser === "function",
        hasGetMeUser: typeof window.Store.User.getMeUser === "function",
      };
    }, fallbackChatId, fallbackWid);
  } catch (error) {
    if (isPuppeteerTargetClosedError(error)) {
      return { patched: false, closed: true };
    }

    logger.warn(`Could not patch WhatsApp user helpers: ${error.message}`);
    return { patched: false, closed: false };
  }
};

const injectMeUserWid = async (client) => {
  if (!isWhatsAppClientUsable(client)) {
    return { injected: false, usable: false };
  }

  let fallbackWid =
    normalizeSerializedWid(client.info?.wid) ||
    normalizeSerializedWid(client.info?.me) ||
    null;

  if (!fallbackWid) {
    fallbackWid = await withTimeout(
      client.pupPage.evaluate(() => {
        const normalize = (value) => {
          if (!value) {
            return null;
          }

          if (typeof value === "string") {
            return value;
          }

          if (value._serialized) {
            return value._serialized;
          }

          if (value.user && value.server) {
            return `${value.user}@${value.server}`;
          }

          if (value.user) {
            return `${value.user}@c.us`;
          }

          return null;
        };

        return (
          normalize(window.Store?.Conn?.wid) ||
          normalize(window.Store?.Conn?.me) ||
          normalize(window.Store?.Conn?.id) ||
          normalize(window.AuthStore?.Conn?.wid) ||
          normalize(window.AuthStore?.Conn?.me) ||
          normalize(window.AuthStore?.Conn?.id) ||
          null
        );
      }),
      1000,
      null
    );
  }

  if (!fallbackWid) {
    return { injected: false, hasFallbackWid: false };
  }

  await client.pupPage.evaluate((meUserWid) => {
    window.WWebJS = window.WWebJS || {};
    window.WWebJS.meUserWid = meUserWid;
  }, fallbackWid);

  return {
    injected: true,
    source: "client.info.wid",
    fallbackWidServer: fallbackWid.split("@")[1] || null,
  };
};

const ensureMessagingInjected = async (client, sessionId, fallbackPhone = null) => {
  if (!isWhatsAppClientUsable(client)) {
    trace("whatsapp.inject.skip_unusable_client", {
      sessionId,
      hasClient: Boolean(client),
      hasPage: Boolean(client?.pupPage),
      pageClosed: client?.pupPage ? client.pupPage.isClosed() : null,
      browserConnected:
        typeof client?.pupBrowser?.isConnected === "function"
          ? client.pupBrowser.isConnected()
          : null,
    }, "warn");
    return false;
  }

  try {
    const pageState = await client.pupPage.evaluate(() => ({
      debugVersion: window.Debug?.VERSION || null,
      authState: window.AuthStore?.AppState?.state || null,
      hasRequire: typeof window.require === "function",
      hasStore: typeof window.Store !== "undefined",
      hasWWebJS: typeof window.WWebJS !== "undefined",
      hasSendMessage: typeof window.WWebJS?.sendMessage === "function",
    }));

    trace("whatsapp.inject.page_state", {
      sessionId,
      ...pageState,
    });

    if (pageState.hasSendMessage && pageState.hasStore) {
      const meUserInjection = await withTimeout(
        injectMeUserWid(client),
        1000,
        { injected: false, timeout: true }
      );
      const helperPatch = meUserInjection.injected
        ? {
            patched: true,
            source: meUserInjection.source,
            hasGetMaybeMeUser: true,
            hasGetMeUser: true,
          }
        : await withTimeout(
            patchWhatsAppUserHelpers(client, fallbackPhone),
            1500,
            { patched: false, timeout: true }
          );
      trace("whatsapp.inject.already_ready", {
        sessionId,
        authState: pageState.authState,
        meUserInjection,
        helperPatch,
      });
      return helperPatch.hasGetMaybeMeUser || helperPatch.patched;
    }

    if (pageState.authState !== "CONNECTED" || !pageState.hasRequire) {
      trace("whatsapp.inject.waiting_for_connected_store", {
        sessionId,
        authState: pageState.authState,
        hasRequire: pageState.hasRequire,
      }, "warn");
      return false;
    }

    if (!pageState.hasStore) {
      trace("whatsapp.inject.expose_store.before", { sessionId });
      await client.pupPage.evaluate(ExposeStore);
      await client.pupPage.waitForFunction("window.Store !== undefined", {
        timeout: 10000,
      });
      trace("whatsapp.inject.expose_store.after", { sessionId });
    }

    trace("whatsapp.inject.load_utils.before", { sessionId });
    await client.pupPage.evaluate(LoadUtils);
    trace("whatsapp.inject.load_utils.after", { sessionId });
    const helperPatch = await patchWhatsAppUserHelpers(client, fallbackPhone);
    trace("whatsapp.inject.helper_patch", {
      sessionId,
      helperPatch,
    });
    if (helperPatch.closed) {
      await cleanupWhatsAppClient(sessionId, client);
      return false;
    }
    if (!helperPatch.patched) {
      logger.warn(
        `WhatsApp user helper patch incomplete for ${sessionId}: ${JSON.stringify(helperPatch)}`
      );
    }

    if (!client.info) {
      trace("whatsapp.inject.client_info.before", { sessionId });
      const info = await client.pupPage.evaluate(() => {
        const getCurrentWid = () => {
          const candidates = [
            window.Store?.User?.getMeUser,
            window.Store?.User?.getMaybeMeUser,
          ];

          for (const getWid of candidates) {
            if (typeof getWid === "function") {
              try {
                const wid = getWid();
                if (wid) {
                  return wid;
                }
              } catch (error) {
                // WhatsApp Web changes these private helpers often; try the next source.
              }
            }
          }

          return (
            window.Store?.Conn?.wid ||
            window.Store?.Conn?.me ||
            window.Store?.Conn?.id ||
            window.AuthStore?.Conn?.wid ||
            null
          );
        };

        return {
          ...window.Store.Conn.serialize(),
          wid: getCurrentWid(),
        };
      });
      client.info = new ClientInfo(client, info);
      client.interface = new InterfaceController(client);
      trace("whatsapp.inject.client_info.after", {
        sessionId,
        hasWid: Boolean(info?.wid),
      });
    }

    const injected = await hasSendMessageHelper(client);
    if (injected) {
      logger.info(`WhatsApp messaging helpers injected for ${sessionId}`);
    }

    return injected;
  } catch (error) {
    if (isPuppeteerTargetClosedError(error)) {
      trace("whatsapp.inject.target_closed", {
        sessionId,
        error: error.message,
      }, "warn");
      await cleanupWhatsAppClient(sessionId, client);
      return false;
    }

    trace("whatsapp.inject.error", {
      sessionId,
      error: error.message,
    }, "warn");
    logger.warn(
      `WhatsApp messaging injection not ready for ${sessionId}: ${error.message}`
    );
    return false;
  }
};

const isWhatsAppClientReady = async (client, sessionId, fallbackPhone = null) => {
  const hasMessaging = await ensureMessagingInjected(client, sessionId, fallbackPhone);
  if (!hasMessaging) {
    trace("whatsapp.ready_check.not_ready", {
      sessionId,
      hasMessaging,
      hasInfo: Boolean(client?.info),
    });
    return false;
  }

  const state = await getClientState(client);
  trace("whatsapp.ready_check.state", {
    sessionId,
    hasMessaging,
    state,
    hasInfo: Boolean(client?.info),
  });
  return Boolean(client?.info) || state === "CONNECTED";
};

const prepareWhatsAppForMessage = async (client, sessionId, fallbackPhone = null) => {
  trace("whatsapp.prepare_message.start", {
    sessionId,
    hasClient: Boolean(client),
    hasInfo: Boolean(client?.info),
    hasPage: Boolean(client?.pupPage),
  });
  const hasMessaging = await ensureMessagingInjected(client, sessionId, fallbackPhone);
  logger.info(`WhatsApp message preparation for ${sessionId}: ${hasMessaging ? "ready" : "not_ready"}`);
  trace("whatsapp.prepare_message.result", {
    sessionId,
    hasMessaging,
    hasInfo: Boolean(client?.info),
  }, hasMessaging ? "info" : "warn");
  if (!hasMessaging) {
    const error = new Error("WhatsApp messaging helpers are not ready yet.");
    error.statusCode = 400;
    throw error;
  }

  return true;
};

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
      dataPath: path.join(__dirname, "../../.wwebjs_auth"),
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
    const initializationPromise = withTimeout(
      whatsapp.initialize().then(() => whatsapp),
      45000,
      null
    ).then((result) => {
      if (!result) {
        const error = new Error("WhatsApp initialization timed out before QR or ready state.");
        error.statusCode = 400;
        throw error;
      }

      return result;
    });
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
};
