const { trace } = require("../utils/trace");

const createInjectMeUserWid = ({
  isWhatsAppClientUsable,
  withTimeout,
  normalizeSerializedWid,
  isLikelyUserWid,
}) => {
  const injectMeUserWid = async (client, fallbackPhone = null) => {
    if (!isWhatsAppClientUsable(client)) {
      return { injected: false, usable: false };
    }

    let fallbackWid =
      normalizeSerializedWid(client.info?.wid) ||
      normalizeSerializedWid(client.info?.me) ||
      null;
    if (fallbackWid && !isLikelyUserWid(fallbackWid)) {
      trace("whatsapp.inject.me_user_wid.invalid_client_info", {
        fallbackWid,
      }, "warn");
      fallbackWid = null;
    }

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
    if (fallbackWid && !isLikelyUserWid(fallbackWid)) {
      trace("whatsapp.inject.me_user_wid.invalid_page_source", {
        fallbackWid,
      }, "warn");
      fallbackWid = null;
    }

    if (!fallbackWid && fallbackPhone) {
      fallbackWid = `${fallbackPhone.toString().replace(/\D/g, "")}@c.us`;
    }

    if (!fallbackWid) {
      return { injected: false, hasFallbackWid: false };
    }

        const injectionInfo = await client.pupPage.evaluate((meUserWid) => {
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
          // Fall back below if WhatsApp's factory is unavailable.
        }

        const [user, server = "c.us"] = serialized.split("@");
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
      };

      const wid = toWid(meUserWid);
      window.WWebJS = window.WWebJS || {};
      window.WWebJS.meUserWid = wid;

      if (wid && window.Store) {
        if (!window.Store.User || Object.isFrozen(window.Store.User)) {
          window.Store.User = { ...(window.Store.User || {}) };
        }

        const getWid = () => wid;
        try {
          Object.defineProperty(window.Store.User, "getMeUser", {
            configurable: true,
            writable: true,
            value: getWid,
          });
        } catch (error) {
          window.Store.User.getMeUser = getWid;
        }

        try {
          Object.defineProperty(window.Store.User, "getMaybeMeUser", {
            configurable: true,
            writable: true,
            value: getWid,
          });
        } catch (error) {
          window.Store.User.getMaybeMeUser = getWid;
        }
      }

      return {
        injected: Boolean(wid),
        widType: wid?.constructor?.name || typeof wid,
        serialized: wid?._serialized || null,
        hasIsUser: typeof wid?.isUser === "function",
        patchedStoreUser: Boolean(wid && window.Store?.User),
      };
    }, fallbackWid);

    return {
      injected: injectionInfo.injected,
      source: "client.info.wid",
      fallbackWidServer: fallbackWid.split("@")[1] || null,
      ...injectionInfo,
    };
  };

  return injectMeUserWid;
};

module.exports = {
  createInjectMeUserWid,
};

