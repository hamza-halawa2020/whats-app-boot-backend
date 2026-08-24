const {
  waitForWhatsAppReady,
  prepareWhatsAppForMessage,
  getSessionId,
} = require("./whatsappService");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const Client = require("../models/Client");
const { normalizePhoneNumber } = require("../utils/phone");

const sendWhatsAppMessage = async ({ user, phone, message }) => {
  const normalizedPhone = normalizePhoneNumber(phone);

  let client = await Client.findOne({
    where: {
      phone: normalizedPhone,
      addedBy: user.id,
    },
  });

  if (!client) {
    client = Client.build({ phone: normalizedPhone, addedBy: user.id });
    await client.save();
  }

  const whatsapp = await waitForWhatsAppReady(user.id, user.phone);
  await prepareWhatsAppForMessage(
    whatsapp,
    getSessionId(user.id, user.phone),
    user.phone
  );

  const chatId = client.phone.endsWith("@c.us")
    ? client.phone
    : `${client.phone}@c.us`;

  const sentMessage = await whatsapp.sendMessage(chatId, message, {
    sendSeen: false,
  });

  const savedMessage = await WhatsAppMessage.build({
    userId: user.id,
    clientId: client.id,
    phone: normalizedPhone,
    message,
    providerMessageId: sentMessage?.id?._serialized || null,
    status: "sent",
  }).save();

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
