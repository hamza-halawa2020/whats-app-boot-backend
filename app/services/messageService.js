const {
  getWhatsAppClient,
  prepareWhatsAppForMessage,
  getSessionId,
} = require("./whatsappService");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const WhatsAppSession = require("../models/WhatsAppSession");
const Client = require("../models/Client");
const { normalizePhoneNumber } = require("../utils/phone");
const { trace } = require("../utils/trace");

const addCandidatePhone = (phones, phone) => {
  if (!phone) {
    return;
  }

  try {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!phones.includes(normalizedPhone)) {
      phones.push(normalizedPhone);
    }
  } catch (error) {
    trace("message.service.sender_candidate.invalid", {
      phone,
      error: error.message,
    }, "warn");
  }
};

const getCandidateSenderPhones = async (user, requestedSenderPhone = null) => {
  const phones = [];
  addCandidatePhone(phones, requestedSenderPhone);
  addCandidatePhone(phones, user.phone);

  const sessions = await WhatsAppSession.findAll({
    where: { userId: user.id },
    order: [["lastActive", "DESC"], ["createdAt", "DESC"]],
  });

  sessions.forEach((session) => {
    if (["ready", "authenticated"].includes(session.status)) {
      addCandidatePhone(phones, session.phone);
    }
  });

  return phones;
};

const findActiveWhatsAppClient = async (user, requestedSenderPhone = null) => {
  const candidatePhones = await getCandidateSenderPhones(user, requestedSenderPhone);

  trace("message.service.sender_candidates", {
    userId: user.id,
    requestedSenderPhone,
    candidatePhones,
  });

  for (const senderPhone of candidatePhones) {
    const sessionId = getSessionId(user.id, senderPhone);
    const whatsapp = getWhatsAppClient(user.id, senderPhone);

    trace("message.service.sender_client.lookup", {
      userId: user.id,
      senderPhone,
      sessionId,
      hasClient: Boolean(whatsapp),
      hasInfo: Boolean(whatsapp?.info),
      hasPage: Boolean(whatsapp?.pupPage),
    });

    if (whatsapp) {
      return { whatsapp, senderPhone, sessionId, candidatePhones };
    }
  }

  return { whatsapp: null, senderPhone: null, sessionId: null, candidatePhones };
};

const sendTextMessage = async (whatsapp, chatId, message) => {
  const normalizeProviderMessageId = (id) => {
    if (!id) {
      return null;
    }

    if (typeof id === "string") {
      return id;
    }

    if (typeof id._serialized === "string") {
      return id._serialized;
    }

    if (typeof id.id === "string") {
      return id.id;
    }

    if (id.from && id.to && id.id) {
      return `${id.from}_${id.to}_${id.id}`;
    }

    return null;
  };

  const registeredWid = await whatsapp.getNumberId(chatId);
  trace("message.service.provider_number_check", {
    chatId,
    isRegistered: Boolean(registeredWid),
    registeredWid: registeredWid?._serialized || null,
  }, registeredWid ? "info" : "warn");

  if (!registeredWid) {
    const error = new Error(`Phone number is not registered on WhatsApp: ${chatId.replace("@c.us", "")}`);
    error.statusCode = 400;
    throw error;
  }

  const providerChatId = registeredWid._serialized || chatId;
  trace("message.service.provider_chat_resolved", {
    requestedChatId: chatId,
    providerChatId,
  });

  let sent;
  let mode = "client_send_message";

  try {
    sent = await whatsapp.sendMessage(providerChatId, message, {
      sendSeen: false,
    });
  } catch (error) {
    if (!/getMessageModel|reading 'serialize'|reading "serialize"/i.test(error.message || "")) {
      throw error;
    }

    trace("message.service.provider_send.fallback", {
      chatId,
      error: error.message,
    }, "warn");

    mode = "direct_store_send_message";
    sent = await whatsapp.pupPage.evaluate(async (providerChatId, content) => {
      const chatWid = window.Store.WidFactory.createWid(providerChatId);
      const chat = await window.Store.Chat.find(chatWid);

      if (!chat) {
        throw new Error(`Chat not found for ${providerChatId}`);
      }

      const meUser =
        window.Store.User?.getMeUser?.() ||
        window.Store.User?.getMaybeMeUser?.() ||
        window.WWebJS?.meUserWid;

      if (!meUser) {
        throw new Error("WhatsApp current user id is not available.");
      }

      const newId = await window.Store.MsgKey.newId();
      const newMsgId = new window.Store.MsgKey({
        from: meUser,
        to: chat.id,
        id: newId,
        participant: chat.id.isGroup() ? meUser : undefined,
        selfDir: "out",
      });
      const ephemeralFields = window.Store.EphemeralFields.getEphemeralFields(chat);
      const outgoingMessage = {
        id: newMsgId,
        ack: 0,
        body: content,
        from: meUser,
        to: chat.id,
        local: true,
        self: "out",
        t: parseInt(new Date().getTime() / 1000, 10),
        isNewMsg: true,
        type: "chat",
        ...ephemeralFields,
      };

      await window.Store.SendMessage.addAndSendMsgToChat(chat, outgoingMessage);

      const widToString = (wid) => {
        if (!wid) {
          return null;
        }

        if (typeof wid === "string") {
          return wid;
        }

        if (typeof wid._serialized === "string") {
          return wid._serialized;
        }

        if (wid.user && wid.server) {
          return `${wid.user}@${wid.server}`;
        }

        return null;
      };

      return {
        id: {
          _serialized:
            typeof newMsgId._serialized === "string"
              ? newMsgId._serialized
              : `${widToString(meUser)}_${widToString(chat.id)}_${newId}`,
        },
      };
    }, providerChatId, message);
  }

  const providerMessageId = normalizeProviderMessageId(sent?.id);

  if (!providerMessageId) {
    const error = new Error("WhatsApp did not confirm the message was sent.");
    error.statusCode = 502;
    throw error;
  }

  return {
    providerMessageId,
    returnedMessage: true,
    chatId: providerChatId,
    mode,
  };
};

const sendWhatsAppMessage = async ({ user, phone, message, senderPhone = null }) => {
  const normalizedPhone = normalizePhoneNumber(phone);

  trace("message.service.start", {
    userId: user.id,
    accountPhone: user.phone,
    requestedSenderPhone: senderPhone,
    rawToPhone: phone,
    normalizedToPhone: normalizedPhone,
    messageLength: message?.length || 0,
  });

  let client = await Client.findOne({
    where: {
      phone: normalizedPhone,
      addedBy: user.id,
    },
  });

  if (!client) {
    client = Client.build({ phone: normalizedPhone, addedBy: user.id });
    await client.save();
    trace("message.service.client.created", {
      userId: user.id,
      clientId: client.id,
      phone: normalizedPhone,
    });
  } else {
    trace("message.service.client.found", {
      userId: user.id,
      clientId: client.id,
      phone: client.phone,
    });
  }

  const activeClient = await findActiveWhatsAppClient(user, senderPhone);
  const { whatsapp, senderPhone: resolvedSenderPhone, sessionId } = activeClient;

  trace("message.service.whatsapp_client.lookup", {
    userId: user.id,
    requestedSenderPhone: senderPhone,
    resolvedSenderPhone,
    sessionId,
    hasClient: Boolean(whatsapp),
    hasInfo: Boolean(whatsapp?.info),
    hasPage: Boolean(whatsapp?.pupPage),
    candidatePhones: activeClient.candidatePhones,
  });

  if (!whatsapp) {
    const error = new Error(
      "No active WhatsApp session was found for this user. Start WhatsApp and scan the QR code, or send senderPhone with the scanned phone number."
    );
    error.statusCode = 400;
    throw error;
  }

  trace("message.service.prepare.before", {
    userId: user.id,
    sessionId,
  });

  await prepareWhatsAppForMessage(
    whatsapp,
    sessionId,
    resolvedSenderPhone
  );

  trace("message.service.prepare.after", {
    userId: user.id,
    sessionId,
  });

  const chatId = client.phone.endsWith("@c.us")
    ? client.phone
    : `${client.phone}@c.us`;

  trace("message.service.provider_send.before", {
    userId: user.id,
    sessionId,
    chatId,
  });

  const sentMessage = await sendTextMessage(whatsapp, chatId, message);

  trace("message.service.provider_send.after", {
    userId: user.id,
    sessionId,
    providerMessageId: sentMessage.providerMessageId,
    sendMode: sentMessage.mode,
    returnedMessage: sentMessage.returnedMessage,
  });

  const savedMessage = await WhatsAppMessage.build({
    userId: user.id,
    clientId: client.id,
    phone: normalizedPhone,
    message,
    providerMessageId: sentMessage.providerMessageId,
    status: "sent",
  }).save();

  trace("message.service.saved", {
    userId: user.id,
    sessionId,
    messageId: savedMessage.id,
    providerMessageId: savedMessage.providerMessageId,
    status: savedMessage.status,
  });

  return {
    phone: normalizedPhone,
    senderPhone: resolvedSenderPhone,
    messageId: savedMessage.id,
    providerMessageId: savedMessage.providerMessageId,
    status: savedMessage.status,
  };
};

module.exports = {
  normalizePhoneNumber,
  sendWhatsAppMessage,
};
