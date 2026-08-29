const logger = require("../utils/logger");
const { trace } = require("../utils/trace");

const createPatchWhatsAppUserHelpers = ({
  isWhatsAppClientUsable,
  isPuppeteerTargetClosedError,
  normalizeSerializedWid,
}) => {
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

          if (value._serialized && typeof value.isUser === "function") {
            return value;
          }

          let serialized = null;
          if (typeof value === "string") {
            const [user, server = "c.us"] = value.split("@");
            if (!user) {
              return null;
            }
            serialized = `${user}@${server}`;
          } else if (value._serialized) {
            serialized = value._serialized;
          } else if (value.user && value.server) {
            serialized = `${value.user}@${value.server}`;
          } else if (value.user) {
            serialized = `${value.user}@c.us`;
          }

          if (!serialized) {
            return null;
          }
          const [serializedUser, serializedServer = "c.us"] = serialized.split("@");
          if (
            (serializedServer === "c.us" || serializedServer === "s.whatsapp.net") &&
            !/^\d{6,15}$/.test(serializedUser)
          ) {
            return null;
          }

          try {
            if (window.Store?.WidFactory?.createWid) {
              return window.Store.WidFactory.createWid(serialized);
            }
          } catch (error) {
            // Fall back to a plain WID-shaped object if WhatsApp's factory changes.
          }

          const [user, server = "c.us"] = serialized.split("@");
          if (user) {
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
          const fallbackWidObject = toWid(fallbackWid) || toWid(fallbackChatId);
          window.WWebJS.meUserWid = fallbackWidObject;

          const getFallbackWid = () =>
            fallbackWidObject || toWid(fallbackWid) || toWid(fallbackChatId);

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
            patched: Boolean(fallbackWidObject),
            source: "client.info.wid",
            hasGetMaybeMeUser: true,
            hasGetMeUser: true,
            meUserWidType: fallbackWidObject?.constructor?.name || typeof fallbackWidObject,
            meUserWidSerialized: fallbackWidObject?._serialized || null,
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

  return patchWhatsAppUserHelpers;
};

module.exports = {
  createPatchWhatsAppUserHelpers,
};

