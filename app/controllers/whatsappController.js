const {
  initializeWhatsApp,
  getWhatsAppClient,
  deleteWhatsAppClient,
} = require("../services/whatsappService");
const WhatsAppSession = require("../models/WhatsAppSession");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const ClientModel = require("../models/Client");

exports.startWhatsApp = async (req, res) => {
  try {
    const userId = req.user._id;
    const phone = req.user.phone;

    if (!phone) {
      return res
        .status(400)
        .json({ success: false, error: "User phone is required" });
    }

    const client = await initializeWhatsApp(userId, phone);

    const session = await WhatsAppSession.findOne({
      user: userId,
      sessionId: `${userId}_${phone}`,
    });

    return res.json({
      success: true,
      message: "WhatsApp client started",
      qrCode: session?.qrCode || null,
      status: session?.status || "starting",
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.sendMessage = async (req, res) => {
  let { phone, message } = req.body;

  if (!phone || !message) {
    return res
      .status(400)
      .json({ success: false, error: "Phone and message are required" });
  }

  try {
    phone = phone.trim().replace(/[^0-9]/g, "");

    let client = await ClientModel.findOne({ phone, addedBy: req.user._id });
    if (!client) {
      client = new ClientModel({ phone, addedBy: req.user._id });
      await client.save();
    }

    let whatsapp = getWhatsAppClient(req.user._id, req.user.phone);
    if (!whatsapp) {
      whatsapp = await initializeWhatsApp(req.user._id, req.user.phone);
    }

    if (!whatsapp || !whatsapp.info) {
      return res
        .status(400)
        .json({ success: false, error: "WhatsApp client is not ready" });
    }

    const chatId = client.phone.endsWith("@c.us")
      ? client.phone
      : `${client.phone}@c.us`;
    await whatsapp.sendMessage(chatId, message);

    const savedMessage = new WhatsAppMessage({
      user: req.user._id,
      client: client._id,
      phone: phone,
      message: message,
    });
    await savedMessage.save();

    return res.status(200).json({
      success: true,
      message: "Message sent successfully",
      phone: phone,
    });
  } catch (error) {
    console.error(`Error sending message: ${error}`);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.restartWhatsAppSession = async (req, res) => {
  const userId = req.user._id;
  const phone = req.user.phone;

  const sessionId = `${userId}_${phone}`;

  try {
    const oldClient = getWhatsAppClient(userId, phone);
    if (oldClient) {
      await deleteWhatsAppClient(sessionId);
    }

    await WhatsAppSession.deleteOne({ user: userId, sessionId });

    const newClient = await initializeWhatsApp(userId, phone);
    const session = await WhatsAppSession.findOne({ user: userId, sessionId });

    return res.json({
      success: true,
      message: "WhatsApp session restarted successfully",
      qrCode: session?.qrCode || null,
      status: session?.status || "starting",
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteWhatsAppSession = async (req, res) => {
  const userId = req.user._id;
  const phone = req.user.phone;

  const sessionId = `${userId}_${phone}`;

  try {
    const oldClient = getWhatsAppClient(userId, phone);
    if (oldClient) {
      await deleteWhatsAppClient(sessionId);
    }

    await WhatsAppSession.deleteOne({ user: userId, sessionId });

    return res.json({
      success: true,
      message: "WhatsApp session deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
