const { trace } = require("../utils/trace");

const createPatchMsgKeyWidInputs = ({
  isWhatsAppClientUsable,
}) => {
  const patchMsgKeyWidInputs = async (client, sessionId) => {
    if (!isWhatsAppClientUsable(client)) {
      return { patched: false, usable: false };
    }

    try {
      const result = await client.pupPage.evaluate(() => {
        if (!window.Store?.MsgKey || !window.Store?.WidFactory?.createWid) {
          return {
            patched: false,
            reason: "missing_msgkey_or_wid_factory",
            hasMsgKey: Boolean(window.Store?.MsgKey),
            hasWidFactory: Boolean(window.Store?.WidFactory?.createWid),
          };
        }

        if (window.WWebJS?.msgKeyWidPatchApplied) {
          return { patched: true, alreadyApplied: true };
        }

        const OriginalMsgKey = window.Store.MsgKey;
        const isValidUserSerialized = (serialized) => {
          if (!serialized || typeof serialized !== "string") {
            return false;
          }

          const [user, server = "c.us"] = serialized.split("@");
          return (
            ["c.us", "s.whatsapp.net"].includes(server) &&
            /^\d{6,15}$/.test(user)
          );
        };
        const getSerialized = (value) => {
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
        const toWid = (value) => {
          if (!value) {
            return value;
          }

          let serialized = getSerialized(value);

          if (!serialized) {
            return value;
          }

          try {
            return window.Store.WidFactory.createWid(serialized);
          } catch (error) {
            return value;
          }
        };

        const PatchedMsgKey = function patchedMsgKey(input) {
          if (input && typeof input === "object") {
            const fallbackMeUser = toWid(window.WWebJS?.meUserWid);
            const fromWid = toWid(input.from);
            const toWidValue = toWid(input.to);
            const participantWid = toWid(input.participant);
            const fromSerialized = getSerialized(fromWid);

            input = {
              ...input,
              from:
                !isValidUserSerialized(fromSerialized) && fallbackMeUser
                  ? fallbackMeUser
                  : fromWid,
              to: toWidValue,
              participant:
                input.participant &&
                !isValidUserSerialized(getSerialized(participantWid)) &&
                fallbackMeUser
                  ? fallbackMeUser
                  : participantWid,
            };
          }

          try {
            return new OriginalMsgKey(input);
          } catch (error) {
            const summarizeWid = (value) =>
              value
                ? {
                    serialized: value._serialized || null,
                    user: value.user || null,
                    server: value.server || null,
                    type: value.constructor?.name || typeof value,
                    hasIsUser: typeof value.isUser === "function",
                    hasIsGroup: typeof value.isGroup === "function",
                  }
                : null;
            error.message = `${error.message}; MsgKey input=${JSON.stringify({
              from: summarizeWid(input?.from),
              to: summarizeWid(input?.to),
              participant: summarizeWid(input?.participant),
              idType: input?.id?.constructor?.name || typeof input?.id,
              selfDir: input?.selfDir || null,
            })}`;
            throw error;
          }
        };

        Object.setPrototypeOf(PatchedMsgKey, OriginalMsgKey);
        PatchedMsgKey.prototype = OriginalMsgKey.prototype;

        for (const propertyName of Object.getOwnPropertyNames(OriginalMsgKey)) {
          if (["length", "name", "prototype"].includes(propertyName)) {
            continue;
          }

          try {
            Object.defineProperty(
              PatchedMsgKey,
              propertyName,
              Object.getOwnPropertyDescriptor(OriginalMsgKey, propertyName)
            );
          } catch (error) {
            // Some bundled properties can be non-configurable; the prototype link covers them.
          }
        }

        window.WWebJS = window.WWebJS || {};
        window.WWebJS.originalMsgKey = OriginalMsgKey;
        window.WWebJS.msgKeyWidPatchApplied = true;
        window.Store.MsgKey = PatchedMsgKey;

        return {
          patched: true,
          originalType: OriginalMsgKey?.name || OriginalMsgKey?.constructor?.name || null,
        };
      });

      trace("whatsapp.msg_key_wid_patch", {
        sessionId,
        ...result,
      }, result.patched ? "info" : "warn");

      return result;
    } catch (error) {
      trace("whatsapp.msg_key_wid_patch.error", {
        sessionId,
        error: error.message,
      }, "warn");
      return { patched: false, error: error.message };
    }
  };

  return patchMsgKeyWidInputs;
};

module.exports = {
  createPatchMsgKeyWidInputs,
};

