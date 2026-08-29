const InterfaceController = require("whatsapp-web.js/src/util/InterfaceController");
const logger = require("../utils/logger");
const { trace } = require("../utils/trace");
const { createHasSendMessageHelper } = require("./whatsappSendMessageHelper");

const createWhatsAppInjectionHelpers = ({
  cleanupWhatsAppClient,
  getClientState,
  isWhatsAppClientUsable,
  isPuppeteerTargetClosedError,
  withTimeout,
  normalizeSerializedWid,
  isLikelyUserWid,
}) => {
  const hasSendMessageHelper = createHasSendMessageHelper({
    isWhatsAppClientUsable,
    isPuppeteerTargetClosedError,
  });

  const getPageMessagingState = async (client) =>
    withTimeout(
      client.pupPage.evaluate(() => ({
        debugVersion: window.Debug?.VERSION || null,
        authState: window.AuthStore?.AppState?.state || null,
        hasRequire: typeof window.require === "function",
        hasWWebJS: typeof window.WWebJS !== "undefined",
        hasSendMessage: typeof window.WWebJS?.sendMessage === "function",
        hasGetChat: typeof window.WWebJS?.getChat === "function",
        hasMePnUser: (() => {
          try {
            const { getMaybeMePnUser } = window.require("WAWebUserPrefsMeUser");
            const wid = getMaybeMePnUser?.();
            return Boolean(wid?.user || wid?._serialized);
          } catch (error) {
            return false;
          }
        })(),
      })),
      2000,
      null
    );

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
      const pageState = await getPageMessagingState(client);

      if (!pageState) {
        trace("whatsapp.inject.page_state.timeout", { sessionId }, "warn");
        return false;
      }

      trace("whatsapp.inject.page_state", {
        sessionId,
        ...pageState,
      });

      if (pageState.authState !== "CONNECTED" || !pageState.hasRequire) {
        trace("whatsapp.inject.waiting_for_connected_store", {
          sessionId,
          authState: pageState.authState,
          hasRequire: pageState.hasRequire,
        }, "warn");
        return false;
      }

      const libraryReady =
        pageState.hasSendMessage &&
        pageState.hasGetChat &&
        (pageState.hasMePnUser ||
          isLikelyUserWid(
            fallbackPhone
              ? `${fallbackPhone.toString().replace(/\D/g, "")}@c.us`
              : null
          ));

      if (!libraryReady) {
        const injected = await withTimeout(hasSendMessageHelper(client), 1500, false);
        trace("whatsapp.inject.library_not_ready", {
          sessionId,
          injected,
          pageState,
        }, "warn");
        return injected;
      }

      if (!client.interface && client.pupPage) {
        client.interface = new InterfaceController(client);
      }

      trace("whatsapp.inject.already_ready", {
        sessionId,
        authState: pageState.authState,
        hasMePnUser: pageState.hasMePnUser,
      });

      return true;
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

    const state = await withTimeout(getClientState(client), 1500, null);
    const meWid = normalizeSerializedWid(client?.info?.wid);
    const pageState = await getPageMessagingState(client);
    const hasValidMeWid =
      pageState?.hasMePnUser ||
      isLikelyUserWid(meWid) ||
      isLikelyUserWid(
        fallbackPhone ? `${fallbackPhone.toString().replace(/\D/g, "")}@c.us` : null
      );

    trace("whatsapp.ready_check.state", {
      sessionId,
      hasMessaging,
      state,
      hasInfo: Boolean(client?.info),
      hasValidMeWid,
      meWid,
      hasMePnUser: pageState?.hasMePnUser || false,
    });

    return state === "CONNECTED" && hasMessaging && hasValidMeWid;
  };

  const prepareWhatsAppForMessage = async (client, sessionId, fallbackPhone = null) => {
    trace("whatsapp.prepare_message.start", {
      sessionId,
      hasClient: Boolean(client),
      hasInfo: Boolean(client?.info),
      hasPage: Boolean(client?.pupPage),
    });
    const hasMessaging = await ensureMessagingInjected(client, sessionId, fallbackPhone);
    logger.info(
      `WhatsApp message preparation for ${sessionId}: ${hasMessaging ? "ready" : "not_ready"}`
    );
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

  return {
    hasSendMessageHelper,
    isWhatsAppClientReady,
    prepareWhatsAppForMessage,
  };
};

module.exports = {
  createWhatsAppInjectionHelpers,
};
