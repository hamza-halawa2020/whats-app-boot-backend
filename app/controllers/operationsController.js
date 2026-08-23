const { sequelize } = require("../config/database");
const User = require("../models/User");
const Client = require("../models/Client");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const WhatsAppSession = require("../models/WhatsAppSession");
const ApiToken = require("../models/ApiToken");
const AuditLog = require("../models/AuditLog");
const ScheduledMessage = require("../models/ScheduledMessage");
const { deleteWhatsAppClient } = require("../services/whatsappService");
const { sendError } = require("../utils/responses");
const logger = require("../utils/logger");

exports.health = async (req, res) => {
  try {
    await sequelize.authenticate();
    return res.json({
      success: true,
      status: "ok",
      database: "ok",
      uptime: process.uptime(),
    });
  } catch (error) {
    logger.error(`Health check failed: ${error}`);
    return res.status(503).json({
      success: false,
      status: "degraded",
      database: "error",
    });
  }
};

exports.dashboard = async (req, res) => {
  try {
    const [users, clients, messages, sessions, apiTokens] = await Promise.all([
      User.count(),
      Client.count(),
      WhatsAppMessage.count(),
      WhatsAppSession.count(),
      ApiToken.count(),
    ]);

    return res.json({
      success: true,
      stats: {
        users,
        clients,
        messages,
        sessions,
        apiTokens,
      },
    });
  } catch (error) {
    logger.error(`Dashboard stats failed: ${error}`);
    return sendError(res, error);
  }
};

exports.usage = async (req, res) => {
  try {
    const userId = req.user.id;
    const [clients, messages, apiTokens, schedules] = await Promise.all([
      Client.count({ where: { addedBy: userId } }),
      WhatsAppMessage.count({ where: { userId } }),
      ApiToken.count({ where: { userId } }),
      ScheduledMessage.count({ where: { userId } }),
    ]);

    return res.json({
      success: true,
      usage: {
        clients,
        messages,
        apiTokens,
        schedules,
      },
    });
  } catch (error) {
    logger.error(`Usage stats failed: ${error}`);
    return sendError(res, error);
  }
};

exports.auditLogs = async (req, res) => {
  try {
    const logs = await AuditLog.findAll({
      order: [["createdAt", "DESC"]],
      limit: Math.min(parseInt(req.query.limit || "50", 10), 200),
    });

    return res.json({
      success: true,
      logs,
    });
  } catch (error) {
    logger.error(`Audit logs failed: ${error}`);
    return sendError(res, error);
  }
};

exports.rateLimits = (req, res) => {
  return res.json({
    success: true,
    rateLimits: {
      messages: {
        windowMs: 15 * 60 * 1000,
        max: 100,
      },
    },
  });
};

exports.adminSessions = async (req, res) => {
  try {
    const sessions = await WhatsAppSession.findAll({
      order: [["createdAt", "DESC"]],
      limit: Math.min(parseInt(req.query.limit || "100", 10), 200),
    });

    return res.json({
      success: true,
      sessions,
    });
  } catch (error) {
    logger.error(`Admin sessions failed: ${error}`);
    return sendError(res, error);
  }
};

exports.adminDisconnectSession = async (req, res) => {
  try {
    const session = await WhatsAppSession.findByPk(req.params.id);
    if (!session) {
      return res.status(404).json({ success: false, error: "Session not found" });
    }

    await deleteWhatsAppClient(session.sessionId);
    session.status = "disconnected";
    session.lastActive = new Date();
    await session.save();

    return res.json({
      success: true,
      message: "Session disconnected",
      session,
    });
  } catch (error) {
    logger.error(`Admin disconnect session failed: ${error}`);
    return sendError(res, error);
  }
};
