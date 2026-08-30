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
const { sendTextViaWWebJS } = require("./whatsappDirectSend");

const inFlightMessageSends = new Map();

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

const getInFlightSendKey = ({ userId, senderPhone, phone, message }) =>
  [userId, senderPhone || "default", phone, message].join(":");

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


  const getSendChatIds = (deliveryChatId, providerChatId) => {
    const ids = [];
    if (deliveryChatId) {
      ids.push(deliveryChatId);
    }
    if (providerChatId && providerChatId !== deliveryChatId) {
      ids.push(providerChatId);
    }
    return [...new Set(ids)];
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
  const deliveryChatId = chatId;
  const sendChatIds = getSendChatIds(deliveryChatId, providerChatId);
  trace("message.service.provider_chat_resolved", {
    requestedChatId: chatId,
    providerChatId,
    deliveryChatId,
    sendChatIds,
  });

  const openedChatId = null;

  let sent;
  let mode = "wwebjs_direct";
  let usedChatId = null;

  trace("message.service.provider_send.direct.before", {
    chatId,
    sendChatIds,
    deliveryChatId,
    providerChatId,
  });

  const directResult = await sendTextViaWWebJS(
    whatsapp,
    deliveryChatId,
    providerChatId,
    message
  );
  if (directResult?.success) {
    sent = { id: { _serialized: directResult.providerMessageId } };
    usedChatId = directResult.chatId;
    mode =
      directResult.chatId !== deliveryChatId
        ? "wwebjs_direct_lid"
        : "wwebjs_direct";
    trace("message.service.provider_send.direct.success", {
      chatId,
      usedChatId,
      providerMessageId: directResult.providerMessageId,
      ack: directResult.ack,
      resolveSource: directResult.resolveSource,
      mode,
    });
  } else {
    trace("message.service.provider_send.direct.failed", {
      chatId,
      sendChatIds,
      errors: directResult?.errors || [],
    }, "warn");

    const error = new Error(
      "WhatsApp sent no confirmation for this message, so it was not retried to avoid duplicate delivery."
    );
    error.statusCode = 424;
    throw error;
  }

  const providerMessageId = normalizeProviderMessageId(sent?.id);

  trace("message.service.provider_send.confirmed", {
    chatId,
    providerChatId,
    deliveryChatId,
    usedChatId,
    openedChatId,
    providerMessageId,
    mode,
    sentIdType: sent?.id?.constructor?.name || typeof sent?.id,
  });

  if (!providerMessageId) {
    const error = new Error("WhatsApp did not confirm the message was sent.");
    error.statusCode = 424;
    throw error;
  }

  return {
    providerMessageId,
    returnedMessage: true,
    chatId: usedChatId || deliveryChatId,
    providerChatId,
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

  const sendKey = getInFlightSendKey({
    userId: user.id,
    senderPhone: resolvedSenderPhone,
    phone: normalizedPhone,
    message,
  });

  if (inFlightMessageSends.has(sendKey)) {
    trace("message.service.in_flight_duplicate", {
      userId: user.id,
      sessionId,
      chatId,
    }, "warn");
    return inFlightMessageSends.get(sendKey);
  }

  const sendPromise = (async () => {
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
      chatId: sentMessage.chatId,
      providerChatId: sentMessage.providerChatId,
      sendMode: sentMessage.mode,
      returnedMessage: sentMessage.returnedMessage,
    });

    const savedMessage = await WhatsAppMessage.build({
      userId: user.id,
      clientId: client.id,
      phone: normalizedPhone,
      message,
      providerMessageId: sentMessage.providerMessageId,
      status: "pending",
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
  })();

  inFlightMessageSends.set(sendKey, sendPromise);

  try {
    return await sendPromise;
  } finally {
    inFlightMessageSends.delete(sendKey);
  }
};

module.exports = {
  normalizePhoneNumber,
  sendWhatsAppMessage,
};
