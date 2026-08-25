const {
  getWhatsAppClient,
  prepareWhatsAppForMessage,
  getSessionId,
} = require("./whatsappService");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const Client = require("../models/Client");
const { normalizePhoneNumber } = require("../utils/phone");
const { trace } = require("../utils/trace");

const sendWhatsAppMessage = async ({ user, phone, message }) => {
  const normalizedPhone = normalizePhoneNumber(phone);
  const sessionId = getSessionId(user.id, user.phone);

  trace("message.service.start", {
    userId: user.id,
    sessionId,
    fromPhone: user.phone,
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

  const whatsapp = getWhatsAppClient(user.id, user.phone);

  trace("message.service.whatsapp_client.lookup", {
    userId: user.id,
    sessionId,
    hasClient: Boolean(whatsapp),
    hasInfo: Boolean(whatsapp?.info),
    hasPage: Boolean(whatsapp?.pupPage),
  });

  if (!whatsapp) {
    const error = new Error(
      "WhatsApp session is not started. Open the WhatsApp page and scan the QR code first."
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
    user.phone
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

  const sentMessage = await whatsapp.sendMessage(chatId, message, {
    sendSeen: false,
  });

  trace("message.service.provider_send.after", {
    userId: user.id,
    sessionId,
    providerMessageId: sentMessage?.id?._serialized || null,
  });

  const savedMessage = await WhatsAppMessage.build({
    userId: user.id,
    clientId: client.id,
    phone: normalizedPhone,
    message,
    providerMessageId: sentMessage?.id?._serialized || null,
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
    messageId: savedMessage.id,
    providerMessageId: savedMessage.providerMessageId,
    status: savedMessage.status,
  };
};

module.exports = {
  normalizePhoneNumber,
  sendWhatsAppMessage,
};
