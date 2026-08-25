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
const { trace } = require("../utils/trace");

exports.health = async (req, res) => {
  try {
    trace("operations.health.request", {
      requestId: req.requestId || null,
    });
    await sequelize.authenticate();
    trace("operations.health.database_ok", {
      requestId: req.requestId || null,
      uptime: process.uptime(),
    });
    return res.json({
      success: true,
      status: "ok",
      database: "ok",
      uptime: process.uptime(),
    });
  } catch (error) {
    trace("operations.health.error", {
      requestId: req.requestId || null,
      error: error.message,
    }, "error");
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
    trace("operations.dashboard.request", {
      requestId: req.requestId || null,
      userId: req.user?.id || null,
    });
    const [users, clients, messages, sessions, apiTokens] = await Promise.all([
      User.count(),
      Client.count(),
      WhatsAppMessage.count(),
      WhatsAppSession.count(),
      ApiToken.count(),
    ]);
    trace("operations.dashboard.response", {
      requestId: req.requestId || null,
      users,
      clients,
      messages,
      sessions,
      apiTokens,
    });

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
    trace("operations.dashboard.error", {
      requestId: req.requestId || null,
      error: error.message,
    }, "error");
    logger.error(`Dashboard stats failed: ${error}`);
    return sendError(res, error);
  }
};

exports.usage = async (req, res) => {
  try {
    const userId = req.user.id;
    trace("operations.usage.request", {
      requestId: req.requestId || null,
      userId,
    });
    const [clients, messages, apiTokens, schedules] = await Promise.all([
      Client.count({ where: { addedBy: userId } }),
      WhatsAppMessage.count({ where: { userId } }),
      ApiToken.count({ where: { userId } }),
      ScheduledMessage.count({ where: { userId } }),
    ]);
    trace("operations.usage.response", {
      requestId: req.requestId || null,
      userId,
      clients,
      messages,
      apiTokens,
      schedules,
    });

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
    trace("operations.usage.error", {
      requestId: req.requestId || null,
      userId: req.user?.id || null,
      error: error.message,
    }, "error");
    logger.error(`Usage stats failed: ${error}`);
    return sendError(res, error);
  }
};

exports.auditLogs = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
    trace("operations.audit_logs.request", {
      requestId: req.requestId || null,
      userId: req.user?.id || null,
      limit,
    });
    const logs = await AuditLog.findAll({
      order: [["createdAt", "DESC"]],
      limit,
    });
    trace("operations.audit_logs.response", {
      requestId: req.requestId || null,
      count: logs.length,
    });

    return res.json({
      success: true,
      logs,
    });
  } catch (error) {
    trace("operations.audit_logs.error", {
      requestId: req.requestId || null,
      error: error.message,
    }, "error");
    logger.error(`Audit logs failed: ${error}`);
    return sendError(res, error);
  }
};

exports.rateLimits = (req, res) => {
  trace("operations.rate_limits.request", {
    requestId: req.requestId || null,
    userId: req.user?.id || null,
  });
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
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 200);
    trace("operations.admin_sessions.request", {
      requestId: req.requestId || null,
      userId: req.user?.id || null,
      limit,
    });
    const sessions = await WhatsAppSession.findAll({
      order: [["createdAt", "DESC"]],
      limit,
    });
    trace("operations.admin_sessions.response", {
      requestId: req.requestId || null,
      count: sessions.length,
    });

    return res.json({
      success: true,
      sessions,
    });
  } catch (error) {
    trace("operations.admin_sessions.error", {
      requestId: req.requestId || null,
      error: error.message,
    }, "error");
    logger.error(`Admin sessions failed: ${error}`);
    return sendError(res, error);
  }
};

exports.adminDisconnectSession = async (req, res) => {
  try {
    trace("operations.admin_disconnect.request", {
      requestId: req.requestId || null,
      userId: req.user?.id || null,
      sessionPk: req.params.id,
    });
    const session = await WhatsAppSession.findByPk(req.params.id);
    if (!session) {
      trace("operations.admin_disconnect.not_found", {
        requestId: req.requestId || null,
        sessionPk: req.params.id,
      }, "warn");
      return res.status(404).json({ success: false, error: "Session not found" });
    }

    await deleteWhatsAppClient(session.sessionId);
    trace("operations.admin_disconnect.client_deleted", {
      requestId: req.requestId || null,
      sessionPk: req.params.id,
      sessionId: session.sessionId,
    });
    session.status = "disconnected";
    session.lastActive = new Date();
    await session.save();
    trace("operations.admin_disconnect.saved", {
      requestId: req.requestId || null,
      sessionPk: req.params.id,
      sessionId: session.sessionId,
    });

    return res.json({
      success: true,
      message: "Session disconnected",
      session,
    });
  } catch (error) {
    trace("operations.admin_disconnect.error", {
      requestId: req.requestId || null,
      sessionPk: req.params.id,
      error: error.message,
    }, "error");
    logger.error(`Admin disconnect session failed: ${error}`);
    return sendError(res, error);
  }
};
