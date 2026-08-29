const {
  initializeWhatsApp,
  getWhatsAppClient,
  getWhatsAppRuntimeStatus,
  deleteWhatsAppClient,
  deleteLocalAuthSession,
  isWhatsAppInitializing,
} = require("../services/whatsappService");
const WhatsAppSession = require("../models/WhatsAppSession");
const { sendWhatsAppMessage } = require("../services/messageService");
const logger = require("../utils/logger");
const { trace } = require("../utils/trace");
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

    trace("whatsapp.wait_session_update.poll", {
      userId,
      sessionId,
      attempt: attempt + 1,
      status: session?.status || null,
      hasQr: Boolean(session?.qrCode),
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
    const sessionId = phone ? `${userId}_${phone}` : null;

    trace("whatsapp.start.request", {
      userId,
      phone,
      sessionId,
    });

    if (!phone) {
      return res
        .status(400)
        .json({ success: false, error: "User phone is required" });
    }

    await initializeWhatsApp(userId, phone);

    const session = await waitForSessionUpdate(userId, sessionId);

    trace("whatsapp.start.response", {
      userId,
      phone,
      sessionId,
      status: session?.status || "starting",
      hasQr: Boolean(session?.qrCode),
    });

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
  trace("whatsapp.controller_send.request", {
    userId: req.user?.id || null,
    fromPhone: req.user?.phone || null,
    toPhone: phone || null,
    messageLength: message?.length || 0,
  });

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
  trace("whatsapp.restart.request", { userId, phone, sessionId });

  try {
    if (isWhatsAppInitializing(userId, phone)) {
      trace("whatsapp.restart.busy", { userId, phone, sessionId }, "warn");
      return res.status(409).json({
        success: false,
        error: "WhatsApp session is still starting. Wait until it is ready before restarting.",
      });
    }

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

    trace("whatsapp.restart.response", {
      userId,
      phone,
      sessionId,
      status: session?.status || "starting",
      hasQr: Boolean(session?.qrCode),
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
  trace("whatsapp.delete.request", { userId, phone, sessionId });

  try {
    if (isWhatsAppInitializing(userId, phone)) {
      trace("whatsapp.delete.busy", { userId, phone, sessionId }, "warn");
      return res.status(409).json({
        success: false,
        error: "WhatsApp session is still starting. Wait until it is ready before deleting.",
      });
    }

    const oldClient = getWhatsAppClient(userId, phone);
    if (oldClient) {
      await deleteWhatsAppClient(sessionId);
    }

    await WhatsAppSession.destroy({ where: { userId, sessionId } });
    const authDeleted = await deleteLocalAuthSession(sessionId);

    trace("whatsapp.delete.response", {
      userId,
      phone,
      sessionId,
      authDeleted,
    });

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
    let session = await WhatsAppSession.findOne({
      where: { userId: req.user.id, sessionId },
      attributes: ["id", "sessionId", "phone", "status", "qrCode", "lastActive", "createdAt"],
    });
    const runtime = await getWhatsAppRuntimeStatus(req.user.id, phone);
    const runtimeReady =
      runtime.hasInfo && runtime.hasSendMessage && runtime.state === "CONNECTED";

    if (runtimeReady && session?.status !== "ready") {
      await WhatsAppSession.update(
        { status: "ready", qrCode: null, lastActive: new Date() },
        { where: { userId: req.user.id, sessionId } }
      );
      session = await WhatsAppSession.findOne({
        where: { userId: req.user.id, sessionId },
        attributes: ["id", "sessionId", "phone", "status", "qrCode", "lastActive", "createdAt"],
      });
      trace("whatsapp.status.promoted_ready", {
        userId: req.user.id,
        phone,
        sessionId,
      });
    }

    const responseStatus =
      session?.status === "ready" && !runtimeReady
        ? runtime.hasClient && !runtime.pageClosed ? "starting" : "disconnected"
        : session?.status || "starting";
    const responseSession = session
      ? { ...session.toJSON(), status: responseStatus }
      : null;

    trace("whatsapp.status.response", {
      userId: req.user.id,
      phone,
      sessionId,
      dbStatus: session?.status || null,
      responseStatus,
      hasQr: Boolean(session?.qrCode),
      runtime,
    });

    return res.json({
      success: true,
      status: responseStatus,
      session: responseSession,
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
