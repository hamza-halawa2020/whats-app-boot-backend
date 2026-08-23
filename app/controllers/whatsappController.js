const {
  initializeWhatsApp,
  getWhatsAppClient,
  getWhatsAppRuntimeStatus,
  deleteWhatsAppClient,
  deleteLocalAuthSession,
} = require("../services/whatsappService");
const WhatsAppSession = require("../models/WhatsAppSession");
const { sendWhatsAppMessage } = require("../services/messageService");
const logger = require("../utils/logger");
const { sendError } = require("../utils/responses");
const { normalizePhoneNumber } = require("../utils/phone");

const getRequestedPhone = (req) =>
  req.body?.phone || req.query?.phone
    ? normalizePhoneNumber(req.body?.phone || req.query?.phone)
    : req.user.phone;

const waitForSessionUpdate = async (userId, sessionId, attempts = 10) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const session = await WhatsAppSession.findOne({
      where: { userId, sessionId },
    });

    if (session?.qrCode || ["ready", "pending", "authenticated"].includes(session?.status)) {
      return session;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return WhatsAppSession.findOne({
    where: { userId, sessionId },
  });
};

exports.startWhatsApp = async (req, res) => {
  try {
    const userId = req.user.id;
    const phone = getRequestedPhone(req);

    if (!phone) {
      return res
        .status(400)
        .json({ success: false, error: "User phone is required" });
    }

    await initializeWhatsApp(userId, phone);

    const sessionId = `${userId}_${phone}`;
    const session = await waitForSessionUpdate(userId, sessionId);

    return res.json({
      success: true,
      message: "WhatsApp client started",
      qrCode: session?.qrCode || null,
      status: session?.status || "starting",
    });
  } catch (error) {
    logger.error(`Error starting WhatsApp session: ${error}`);
    return sendError(res, error);
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
    const result = await sendWhatsAppMessage({
      user: req.user,
      phone,
      message,
    });

    return res.status(200).json({
      success: true,
      message: "Message sent successfully",
      phone: result.phone,
    });
  } catch (error) {
    logger.error(`Error sending message: ${error}`);
    return sendError(res, error);
  }
};

exports.restartWhatsAppSession = async (req, res) => {
  const userId = req.user.id;
  const phone = getRequestedPhone(req);

  const sessionId = `${userId}_${phone}`;

  try {
    const oldClient = getWhatsAppClient(userId, phone);
    if (oldClient) {
      await deleteWhatsAppClient(sessionId);
    }

    await WhatsAppSession.destroy({ where: { userId, sessionId } });
    await deleteLocalAuthSession(sessionId);

    await initializeWhatsApp(userId, phone);
    const session = await WhatsAppSession.findOne({
      where: { userId, sessionId },
    });

    return res.json({
      success: true,
      message: "WhatsApp session restarted successfully",
      qrCode: session?.qrCode || null,
      status: session?.status || "starting",
    });
  } catch (error) {
    logger.error(`Error restarting WhatsApp session: ${error}`);
    return sendError(res, error);
  }
};

exports.deleteWhatsAppSession = async (req, res) => {
  const userId = req.user.id;
  const phone = getRequestedPhone(req);

  const sessionId = `${userId}_${phone}`;

  try {
    const oldClient = getWhatsAppClient(userId, phone);
    if (oldClient) {
      await deleteWhatsAppClient(sessionId);
    }

    await WhatsAppSession.destroy({ where: { userId, sessionId } });
    await deleteLocalAuthSession(sessionId);

    return res.json({
      success: true,
      message: "WhatsApp session deleted successfully",
    });
  } catch (error) {
    logger.error(`Error deleting WhatsApp session: ${error}`);
    return sendError(res, error);
  }
};

exports.getSessions = async (req, res) => {
  try {
    const sessions = await WhatsAppSession.findAll({
      where: { userId: req.user.id },
      attributes: ["id", "sessionId", "phone", "status", "lastActive", "createdAt"],
      order: [["createdAt", "DESC"]],
    });

    return res.json({
      success: true,
      sessions,
    });
  } catch (error) {
    logger.error(`Error listing WhatsApp sessions: ${error}`);
    return sendError(res, error);
  }
};

exports.getSessionStatus = async (req, res) => {
  try {
    const phone = getRequestedPhone(req);
    const sessionId = `${req.user.id}_${phone}`;
    const session = await WhatsAppSession.findOne({
      where: { userId: req.user.id, sessionId },
      attributes: ["id", "sessionId", "phone", "status", "qrCode", "lastActive", "createdAt"],
    });
    const runtime = await getWhatsAppRuntimeStatus(req.user.id, phone);

    return res.json({
      success: true,
      status: session?.status || "starting",
      session: session || null,
      runtime,
    });
  } catch (error) {
    logger.error(`Error fetching WhatsApp session status: ${error}`);
    return sendError(res, error);
  }
};

exports.refreshQr = async (req, res) => {
  req.body.phone = getRequestedPhone(req);
  return exports.restartWhatsAppSession(req, res);
};
