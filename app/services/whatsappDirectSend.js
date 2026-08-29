const { trace } = require("../utils/trace");

const sendTextViaWWebJS = async (client, deliveryChatId, providerChatId, content) => {
  if (!client?.pupPage || client.pupPage.isClosed()) {
    return { success: false, errors: [{ error: "page_unavailable" }] };
  }

  const result = await client.pupPage.evaluate(
    async (deliveryChatId, providerChatId, content) => {
      const errors = [];
      const candidateIds = [...new Set([deliveryChatId, providerChatId].filter(Boolean))];

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
        return null;
      };

      const getProviderMessageId = (msg, fallbackKey) => {
        if (fallbackKey?._serialized) {
          return fallbackKey._serialized;
        }

        if (!msg?.id) {
          return null;
        }

        if (typeof msg.id._serialized === "string") {
          return msg.id._serialized;
        }

        if (typeof msg.id === "string") {
          return msg.id;
        }

        const from = getSerialized(msg.id.from);
        const to = getSerialized(msg.id.to);
        const id = msg.id.id;
        if (from && to && id) {
          return `${from}_${to}_${id}`;
        }

        return null;
      };

      const sendTextToChat = async (chat) => {
        const { getMaybeMeLidUser, getMaybeMePnUser } = window.require(
          "WAWebUserPrefsMeUser"
        );
        const WidFactory = window.require("WAWebWidFactory");
        const MsgKey = window.require("WAWebMsgKey");
        const lidUser = getMaybeMeLidUser();
        const meUser = getMaybeMePnUser();
        const newId = await MsgKey.newId();
        const isLidChat =
          typeof chat.id?.isLid === "function" && chat.id.isLid();
        let from = isLidChat ? lidUser : meUser;
        let participant;

        if (typeof chat.id?.isGroup === "function" && chat.id.isGroup()) {
          from =
            chat.groupMetadata && chat.groupMetadata.isLidAddressingMode
              ? lidUser
              : meUser;
          participant = WidFactory.asUserWidOrThrow(from);
        }

        if (typeof chat.id?.isStatus === "function" && chat.id.isStatus()) {
          participant = WidFactory.asUserWidOrThrow(from);
        }

        const newMsgKey = new MsgKey({
          from,
          to: chat.id,
          id: newId,
          participant,
          selfDir: "out",
        });
        const providerMessageId = newMsgKey._serialized;

        const ephemeralFields = window
          .require("WAWebGetEphemeralFieldsMsgActionsUtils")
          .getEphemeralFields(chat);

        const message = {
          id: newMsgKey,
          ack: 0,
          body: content,
          from,
          to: chat.id,
          local: true,
          self: "out",
          t: parseInt(new Date().getTime() / 1000, 10),
          isNewMsg: true,
          type: "chat",
          ...ephemeralFields,
        };

        const [msgPromise, sendMsgResultPromise] = window
          .require("WAWebSendMsgChatAction")
          .addAndSendMsgToChat(chat, message);
        await msgPromise;
        await sendMsgResultPromise;

        const Msg = window.require("WAWebCollections").Msg;
        const storedMsg = Msg.get(providerMessageId);
        return {
          providerMessageId:
            getProviderMessageId(storedMsg, newMsgKey) || providerMessageId,
          ack: storedMsg?.ack ?? 0,
        };
      };

      for (const chatId of candidateIds) {
        try {
          const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
          if (!chat?.id) {
            errors.push({ chatId, error: "chat_not_resolved" });
            continue;
          }

          const sendResult = await sendTextToChat(chat);
          if (!sendResult?.providerMessageId) {
            errors.push({ chatId, error: "missing_message_id" });
            continue;
          }

          return {
            success: true,
            providerMessageId: sendResult.providerMessageId,
            chatId: getSerialized(chat.id) || chatId,
            ack: sendResult.ack ?? null,
          };
        } catch (error) {
          errors.push({
            chatId,
            error: error?.message || String(error),
          });
        }
      }

      return { success: false, errors };
    },
    deliveryChatId,
    providerChatId,
    content
  );

  trace("whatsapp.direct_send.result", {
    deliveryChatId,
    providerChatId,
    success: Boolean(result?.success),
    providerMessageId: result?.providerMessageId || null,
    chatId: result?.chatId || null,
    errors: result?.errors || [],
  }, result?.success ? "info" : "warn");

  return result;
};

module.exports = {
  sendTextViaWWebJS,
};
