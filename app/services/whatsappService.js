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

const clients = new Map();
const readyWaiters = new Map();

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
  await WhatsAppSession.update(
    { status: "ready", qrCode: null, lastActive: new Date() },
    { where: { userId, sessionId } }
  );
  logger.info(`WhatsApp client ready for user ${userId}`);
  const waiters = readyWaiters.get(sessionId) || [];
  waiters.forEach((resolve) => resolve(whatsapp));
  readyWaiters.delete(sessionId);
};

const getClientState = async (client) => {
  try {
    return await client.getState();
  } catch (error) {
    return null;
  }
};

const hasSendMessageHelper = async (client) => {
  try {
    return await client.pupPage?.evaluate(
      () => typeof window.WWebJS?.sendMessage === "function"
    );
  } catch (error) {
    return false;
  }
};

const patchWhatsAppUserHelpers = async (client, fallbackPhone = null) => {
  if (!client?.pupPage) {
    return false;
  }

  try {
    const fallbackChatId = fallbackPhone
      ? `${fallbackPhone.toString().replace(/\D/g, "")}@c.us`
      : null;

    return await client.pupPage.evaluate((fallbackChatId) => {
      const toWid = (value) => {
        if (!value) {
          return null;
        }

        if (value._serialized || (value.user && value.server)) {
          return value;
        }

        if (typeof value === "string") {
          try {
            return window.Store?.WidFactory?.createWid(value);
          } catch (error) {
            return null;
          }
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
    }, fallbackChatId);
  } catch (error) {
    logger.warn(`Could not patch WhatsApp user helpers: ${error.message}`);
    return { patched: false };
  }
};

const ensureMessagingInjected = async (client, sessionId, fallbackPhone = null) => {
  if (!client?.pupPage) {
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

    if (pageState.hasSendMessage) {
      const helperPatch = await patchWhatsAppUserHelpers(client, fallbackPhone);
      if (!helperPatch.patched) {
        logger.warn(
          `WhatsApp user helper patch incomplete for ${sessionId}: ${JSON.stringify(helperPatch)}`
        );
      }
      return helperPatch.hasGetMaybeMeUser;
    }

    if (pageState.authState !== "CONNECTED" || !pageState.hasRequire) {
      return false;
    }

    if (!pageState.hasStore) {
      await client.pupPage.evaluate(ExposeStore);
      await client.pupPage.waitForFunction("window.Store !== undefined", {
        timeout: 10000,
      });
    }

    await client.pupPage.evaluate(LoadUtils);
    const helperPatch = await patchWhatsAppUserHelpers(client, fallbackPhone);
    if (!helperPatch.patched) {
      logger.warn(
        `WhatsApp user helper patch incomplete for ${sessionId}: ${JSON.stringify(helperPatch)}`
      );
    }

    if (!client.info) {
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
    }

    const injected = await hasSendMessageHelper(client);
    if (injected) {
      logger.info(`WhatsApp messaging helpers injected for ${sessionId}`);
    }

    return injected;
  } catch (error) {
    logger.warn(
      `WhatsApp messaging injection not ready for ${sessionId}: ${error.message}`
    );
    return false;
  }
};

const isWhatsAppClientReady = async (client, sessionId, fallbackPhone = null) => {
  const hasMessaging = await ensureMessagingInjected(client, sessionId, fallbackPhone);
  if (!hasMessaging) {
    return false;
  }

  const state = await getClientState(client);
  return Boolean(client?.info) || state === "CONNECTED";
};

const prepareWhatsAppForMessage = async (client, sessionId, fallbackPhone = null) => {
  const hasMessaging = await ensureMessagingInjected(client, sessionId, fallbackPhone);
  if (!hasMessaging) {
    const error = new Error("WhatsApp messaging helpers are not ready yet.");
    error.statusCode = 400;
    throw error;
  }

  return true;
};

const initializeWhatsApp = async (userId, phone) => {
  const sessionId = getSessionId(userId, phone);

  if (clients.has(sessionId)) {
    return clients.get(sessionId);
  }

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
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  clients.set(sessionId, whatsapp);

  whatsapp.on("qr", async (qr) => {
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
    logger.info(`WhatsApp loading ${percent}% for ${sessionId}: ${message}`);
  });

  whatsapp.on("authenticated", async (session) => {
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
    await WhatsAppSession.update(
      { status: "auth_failure", lastActive: new Date() },
      { where: { userId, sessionId } }
    );
    logger.error(`WhatsApp auth failure for ${sessionId}: ${message}`);
  });

  whatsapp.on("change_state", async (state) => {
    logger.info(`WhatsApp state changed for ${sessionId}: ${state}`);
  });

  whatsapp.on("ready", async () => {
    await markSessionReady(userId, sessionId, whatsapp);
  });

  whatsapp.on("message_ack", updateMessageAck);

  whatsapp.on("disconnected", async () => {
    await WhatsAppSession.update(
      { status: "disconnected", lastActive: new Date() },
      { where: { userId, sessionId } }
    );
    clients.delete(sessionId);
    readyWaiters.delete(sessionId);
    await whatsapp.destroy();
  });

  try {
    await whatsapp.initialize();
    if (await isWhatsAppClientReady(whatsapp, sessionId, phone)) {
      await markSessionReady(userId, sessionId, whatsapp);
    }
    return whatsapp;
  } catch (err) {
    clients.delete(sessionId);
    readyWaiters.delete(sessionId);
    logger.error(`WhatsApp initialization error: ${err}`);
    if (err.message?.includes("Failed to launch the browser process")) {
      err.statusCode = 400;
      err.message =
        "Chrome or Edge could not be launched for WhatsApp. Set CHROME_EXECUTABLE_PATH in .env.";
    }
    throw err;
  }
};

const getWhatsAppClient = (userId, phone) => clients.get(getSessionId(userId, phone));

const getWhatsAppRuntimeStatus = async (userId, phone) => {
  const sessionId = getSessionId(userId, phone);
  const client = clients.get(sessionId);
  const state = client ? await getClientState(client) : null;
  const hasSendMessage = client ? await hasSendMessageHelper(client) : false;

  return {
    hasClient: Boolean(client),
    hasInfo: Boolean(client?.info),
    hasSendMessage,
    state,
  };
};

const waitForWhatsAppReady = async (userId, phone, timeoutMs = 60000) => {
  const sessionId = getSessionId(userId, phone);
  let whatsapp = clients.get(sessionId);

  if (!whatsapp) {
    whatsapp = await initializeWhatsApp(userId, phone);
  }

  if (await isWhatsAppClientReady(whatsapp, sessionId, phone)) {
    return whatsapp;
  }

  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      if (await isWhatsAppClientReady(whatsapp, sessionId, phone)) {
        clearInterval(interval);
        clearTimeout(timeout);
        await markSessionReady(userId, sessionId, whatsapp);
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
  if (clients.has(sessionId)) {
    const client = clients.get(sessionId);
    await client.destroy();
    clients.delete(sessionId);
    readyWaiters.delete(sessionId);
  }
};

const deleteLocalAuthSession = async (sessionId) => {
  const sessionPath = getLocalAuthSessionPath(sessionId);
  await fs.rm(sessionPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 300,
  });
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
