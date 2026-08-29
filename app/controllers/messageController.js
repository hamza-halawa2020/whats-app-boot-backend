const {
  waitForWhatsAppReady,
  prepareWhatsAppForMessage,
  getSessionId,
} = require("../services/whatsappService");
const logger = require("../utils/logger");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const Client = require("../models/Client");
const ApiToken = require("../models/ApiToken");
const MessageTemplate = require("../models/MessageTemplate");
const { sendWhatsAppMessage } = require("../services/messageService");
const { Op } = require("sequelize");
const { normalizePhoneNumber } = require("../utils/phone");
const { sendError } = require("../utils/responses");
const { trace } = require("../utils/trace");
const { startSchedule, pauseSchedule } = require("../services/scheduleService");

const ScheduledMessage = require("../models/ScheduledMessage");

const notifyWebhook = async (apiToken, payload) => {
  if (!apiToken?.webhookUrl) {
    return;
  }

  try {
    await fetch(apiToken.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    logger.error(`Webhook callback failed: ${error}`);
  }
};

exports.sendMessage = async (req, res) => {
  let { phone, message, senderPhone, fromPhone, sessionPhone } = req.body;
  const requestedSenderPhone = senderPhone || fromPhone || sessionPhone || null;

  trace("message.controller_send.request", {
    userId: req.user?.id || null,
    accountPhone: req.user?.phone || null,
    requestedSenderPhone,
    toPhone: phone || null,
    messageLength: message?.length || 0,
  });

  if (!phone || !message) {
    return res.status(400).json({
      success: false,
      error: "Phone and message are required",
    });
  }

  try {
    const result = await sendWhatsAppMessage({
      user: req.user,
      phone,
      message,
      senderPhone: requestedSenderPhone,
    });

    return res.status(200).json({
      success: true,
      message: "Message accepted by WhatsApp client",
      phone: result.phone,
      senderPhone: result.senderPhone,
      status: result.status,
      messageId: result.messageId,
      providerMessageId: result.providerMessageId,
    });
  } catch (error) {
    trace(
      "message.controller_send.error",
      {
        userId: req.user?.id || null,
        toPhone: phone || null,
        requestedSenderPhone,
        error: error.message,
        statusCode: error.statusCode || 500,
      },
      error.statusCode && error.statusCode < 500 ? "warn" : "error"
    );
    logger.error(`Error sending message: ${error}`);
    return sendError(res, error);
  }
};

exports.generateApiToken = async (req, res) => {
  const userId = req.user.id;
  const userPhone = req.user.phone;
  const {
    name = null,
    scopes = ["messages:send"],
    webhookUrl = null,
    expiresAt = null,
    phone = null,
    senderPhone = null,
    fromPhone = null,
    sessionPhone = null,
  } = req.body;
  const tokenPhone = normalizePhoneNumber(
    phone || senderPhone || fromPhone || sessionPhone || userPhone
  );

  try {
    trace("tokens.generate.request", {
      requestId: req.requestId || null,
      userId,
      userPhone,
      tokenPhone,
      name,
      scopes,
      hasWebhookUrl: Boolean(webhookUrl),
      expiresAt,
    });
    // Check if user has a WhatsApp client ready
    await waitForWhatsAppReady(userId, tokenPhone);
    trace("tokens.generate.whatsapp_ready", {
      requestId: req.requestId || null,
      userId,
      tokenPhone,
    });

    const rawToken = ApiToken.generateRawToken();
    const apiToken = ApiToken.build({
      userId,
      phone: tokenPhone,
      token: ApiToken.hashToken(rawToken),
      name,
      scopes,
      webhookUrl,
      expiresAt,
    });
    await apiToken.save();
    trace("tokens.generate.saved", {
      requestId: req.requestId || null,
      userId,
      tokenId: apiToken.id,
      scopes: apiToken.scopes,
    });

    return res.status(200).json({
      success: true,
      message: "API token generated successfully",
      token: rawToken,
    });
  } catch (error) {
    trace("tokens.generate.error", {
      requestId: req.requestId || null,
      userId,
      error: error.message,
    }, "error");
    logger.error(`Error generating API token: ${error}`);
    return sendError(res, error);
  }
};

exports.sendMessageWithApiToken = async (req, res) => {
  let { phone, message, senderPhone, fromPhone, sessionPhone } = req.body;
  const requestedSenderPhone = senderPhone || fromPhone || sessionPhone || req.user?.phone || null;
  trace("message.external_send.request", {
    requestId: req.requestId || null,
    userId: req.user?.id || null,
    apiTokenId: req.apiToken?.id || null,
    accountPhone: req.user?.phone || null,
    requestedSenderPhone,
    toPhone: phone || null,
    messageLength: message?.length || 0,
  });

  if (!phone || !message) {
    trace("message.external_send.validation_failed", {
      requestId: req.requestId || null,
      hasPhone: Boolean(phone),
      hasMessage: Boolean(message),
    }, "warn");
    return res.status(400).json({
      success: false,
      error: "Phone and message are required",
    });
  }

  try {
    const result = await sendWhatsAppMessage({
      user: req.user,
      phone,
      message,
      senderPhone: requestedSenderPhone,
    });
    trace("message.external_send.sent", {
      requestId: req.requestId || null,
      userId: req.user?.id || null,
      apiTokenId: req.apiToken?.id || null,
      phone: result.phone,
      senderPhone: result.senderPhone,
      messageId: result.messageId,
      providerMessageId: result.providerMessageId,
      status: result.status,
    });

    await notifyWebhook(req.apiToken, {
      event: "message.sent",
      phone: result.phone,
      messageId: result.messageId,
      providerMessageId: result.providerMessageId,
      status: result.status,
    });
    trace("message.external_send.webhook_notified", {
      requestId: req.requestId || null,
      apiTokenId: req.apiToken?.id || null,
      hasWebhookUrl: Boolean(req.apiToken?.webhookUrl),
    });

    return res.status(200).json({
      success: true,
      message: "Message sent successfully",
      phone: result.phone,
      senderPhone: result.senderPhone,
      messageId: result.messageId,
      status: result.status,
    });
  } catch (error) {
    await notifyWebhook(req.apiToken, {
      event: "message.failed",
      phone,
      error: error.message,
    });
    trace("message.external_send.error", {
      requestId: req.requestId || null,
      userId: req.user?.id || null,
      apiTokenId: req.apiToken?.id || null,
      phone,
      requestedSenderPhone,
      error: error.message,
      statusCode: error.statusCode || 500,
    }, error.statusCode && error.statusCode < 500 ? "warn" : "error");
    logger.error(`Error sending message with API token: ${error}`);
    return sendError(res, error);
  }
};

exports.getApiTokens = async (req, res) => {
  const userId = req.user.id;

  try {
    trace("tokens.list.request", {
      requestId: req.requestId || null,
      userId,
    });
    const tokens = await ApiToken.findAll({
      where: { userId },
      attributes: [
        "id",
        "name",
        "phone",
        "scopes",
        "webhookUrl",
        "expiresAt",
        "lastUsedAt",
        "createdAt",
      ],
    });
    trace("tokens.list.response", {
      requestId: req.requestId || null,
      userId,
      count: tokens.length,
    });
    return res.status(200).json({
      success: true,
      message: "API tokens fetched successfully",
      tokens,
    });
  } catch (error) {
    trace("tokens.list.error", {
      requestId: req.requestId || null,
      userId,
      error: error.message,
    }, "error");
    logger.error(`Error fetching API tokens: ${error}`);
    return sendError(res, error);
  }
};

exports.updateApiToken = async (req, res) => {
  const userId = req.user.id;
  const { tokenId } = req.params;
  const { name, scopes, webhookUrl, expiresAt } = req.body;

  try {
    trace("tokens.update.request", {
      requestId: req.requestId || null,
      userId,
      tokenId,
      fields: Object.keys(req.body || {}),
    });
    const apiToken = await ApiToken.findOne({ where: { id: tokenId, userId } });
    if (!apiToken) {
      trace("tokens.update.not_found", {
        requestId: req.requestId || null,
        userId,
        tokenId,
      }, "warn");
      return res.status(404).json({
        success: false,
        error: "Token not found or not authorized",
      });
    }

    if (name !== undefined) apiToken.name = name;
    if (scopes !== undefined) apiToken.scopes = scopes;
    if (webhookUrl !== undefined) apiToken.webhookUrl = webhookUrl;
    if (expiresAt !== undefined) apiToken.expiresAt = expiresAt || null;

    await apiToken.save();
    trace("tokens.update.saved", {
      requestId: req.requestId || null,
      userId,
      tokenId: apiToken.id,
    });

    return res.json({
      success: true,
      message: "API token updated successfully",
      token: {
        id: apiToken.id,
        name: apiToken.name,
        phone: apiToken.phone,
        scopes: apiToken.scopes,
        webhookUrl: apiToken.webhookUrl,
        expiresAt: apiToken.expiresAt,
        lastUsedAt: apiToken.lastUsedAt,
        createdAt: apiToken.createdAt,
      },
    });
  } catch (error) {
    trace("tokens.update.error", {
      requestId: req.requestId || null,
      userId,
      tokenId,
      error: error.message,
    }, "error");
    logger.error(`Error updating API token: ${error}`);
    return sendError(res, error);
  }
};

exports.rotateApiToken = async (req, res) => {
  const userId = req.user.id;
  const { tokenId } = req.params;

  try {
    trace("tokens.rotate.request", {
      requestId: req.requestId || null,
      userId,
      tokenId,
    });
    const apiToken = await ApiToken.findOne({ where: { id: tokenId, userId } });
    if (!apiToken) {
      trace("tokens.rotate.not_found", {
        requestId: req.requestId || null,
        userId,
        tokenId,
      }, "warn");
      return res.status(404).json({
        success: false,
        error: "Token not found or not authorized",
      });
    }

    const rawToken = ApiToken.generateRawToken();
    apiToken.token = ApiToken.hashToken(rawToken);
    apiToken.lastUsedAt = null;
    await apiToken.save();
    trace("tokens.rotate.saved", {
      requestId: req.requestId || null,
      userId,
      tokenId: apiToken.id,
    });

    return res.json({
      success: true,
      message: "API token rotated successfully",
      token: rawToken,
    });
  } catch (error) {
    trace("tokens.rotate.error", {
      requestId: req.requestId || null,
      userId,
      tokenId,
      error: error.message,
    }, "error");
    logger.error(`Error rotating API token: ${error}`);
    return sendError(res, error);
  }
};

exports.revokeApiToken = async (req, res) => {
  const userId = req.user.id;
  const { tokenId } = req.body;

  if (!tokenId) {
    trace("tokens.revoke.validation_failed", {
      requestId: req.requestId || null,
      userId,
      reason: "missing_token_id",
    }, "warn");
    return res.status(400).json({
      success: false,
      error: "Token ID is required",
    });
  }

  try {
    trace("tokens.revoke.request", {
      requestId: req.requestId || null,
      userId,
      tokenId,
    });
    const token = await ApiToken.findOne({
      where: {
        id: tokenId,
        userId,
      },
    });

    if (!token) {
      trace("tokens.revoke.not_found", {
        requestId: req.requestId || null,
        userId,
        tokenId,
      }, "warn");
      return res.status(404).json({
        success: false,
        error: "Token not found or not authorized",
      });
    }

    await token.destroy();
    trace("tokens.revoke.deleted", {
      requestId: req.requestId || null,
      userId,
      tokenId,
    });

    return res.status(200).json({
      success: true,
      message: "API token revoked successfully",
    });
  } catch (error) {
    trace("tokens.revoke.error", {
      requestId: req.requestId || null,
      userId,
      tokenId,
      error: error.message,
    }, "error");
    logger.error(`Error revoking API token: ${error}`);
    return sendError(res, error);
  }
};

exports.sendRandomMessages = async (req, res) => {
  const {
    senderPhone,
    fromPhone,
    sessionPhone,
    messagePool,
    phoneNumbers, // Array of specific phone numbers (optional, replaces clientIds)
    batchSize = 10,
    intervalMs = 5000, // Interval between batches
    repeatIntervalMs, // Interval for repeating messages (e.g., every 1 hour)
    repeatCount = 0, // Number of times to repeat (0 for indefinite)
  } = req.body;
  const userId = req.user.id;
  const userPhone = normalizePhoneNumber(senderPhone || fromPhone || sessionPhone || req.user.phone);
  trace("message.broadcast.request", {
    requestId: req.requestId || null,
    userId,
    accountPhone: req.user.phone,
    senderPhone: userPhone,
    phoneNumbersCount: Array.isArray(phoneNumbers) ? phoneNumbers.length : 0,
    messagePoolCount: Array.isArray(messagePool) ? messagePool.length : 0,
    batchSize,
    intervalMs,
    repeatIntervalMs: repeatIntervalMs || null,
    repeatCount,
  });

  const defaultMessages = [
    "Hello! Stay tuned for updates.",
    "Greetings! How can we assist you today?",
    "Check out our latest offers!",
  ];
  const messages =
    Array.isArray(messagePool) && messagePool.length > 0
      ? messagePool
      : defaultMessages;

  try {
    // Validate input
    if (
      !phoneNumbers ||
      !Array.isArray(phoneNumbers) ||
      phoneNumbers.length === 0
    ) {
      trace("message.broadcast.validation_failed", {
        requestId: req.requestId || null,
        userId,
        reason: "missing_phone_numbers",
      }, "warn");
      return res
        .status(400)
        .json({ success: false, error: "Phone numbers are required" });
    }

    // Validate and clean phone numbers
    const cleanedPhoneNumbers = phoneNumbers.map(normalizePhoneNumber);
    trace("message.broadcast.normalized", {
      requestId: req.requestId || null,
      userId,
      cleanedPhoneNumbersCount: cleanedPhoneNumbers.length,
    });

    // Save or update clients
    const clients = [];
    for (const phone of cleanedPhoneNumbers) {
      let client = await Client.findOne({
        where: { phone, addedBy: userId },
      });
      if (!client) {
        client = Client.build({ phone, addedBy: userId });
        await client.save();
      }
      clients.push(client);
    }
    trace("message.broadcast.clients_ready", {
      requestId: req.requestId || null,
      userId,
      clientsCount: clients.length,
    });

    // Initialize WhatsApp client
    const whatsapp = await waitForWhatsAppReady(userId, userPhone);
    await prepareWhatsAppForMessage(
      whatsapp,
      getSessionId(userId, userPhone),
      userPhone
    );
    trace("message.broadcast.whatsapp_ready", {
      requestId: req.requestId || null,
      userId,
      userPhone,
    });

    // Save scheduling details if repeatIntervalMs is provided
    let scheduleId;
    if (repeatIntervalMs && repeatIntervalMs > 0) {
      const scheduledMessage = ScheduledMessage.build({
        userId,
        phoneNumbers: cleanedPhoneNumbers,
        messagePool: messages,
        intervalMs: repeatIntervalMs,
        repeatCount,
      });
      await scheduledMessage.save();
      scheduleId = scheduledMessage.id;
      trace("message.broadcast.schedule_created", {
        requestId: req.requestId || null,
        userId,
        scheduleId,
        repeatIntervalMs,
        repeatCount,
      });
    }

    // Function to send a batch of messages
    const sendBatch = async (clientsToSend) => {
      let sentCount = 0;
      let failedCount = 0;
      const errors = [];

      for (const client of clientsToSend) {
        const randomMessage =
          messages[Math.floor(Math.random() * messages.length)];
        const chatId = client.phone.endsWith("@c.us")
          ? client.phone
          : `${client.phone}@c.us`;

        try {
          let sentMessage;
          let lastError;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              sentMessage = await whatsapp.sendMessage(chatId, randomMessage, {
                sendSeen: false,
              });
              lastError = null;
              break;
            } catch (error) {
              lastError = error;
              await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
            }
          }

          if (lastError) {
            throw lastError;
          }

          await WhatsAppMessage.build({
            userId,
            clientId: client.id,
            phone: client.phone,
            message: randomMessage,
            providerMessageId: sentMessage?.id?._serialized || null,
            status: "sent",
          }).save();
          sentCount++;
        } catch (err) {
          failedCount++;
          errors.push({ phone: client.phone, error: err.message });
          logger.error(`Error sending to ${client.phone}: ${err}`);
          await WhatsAppMessage.build({
            userId,
            clientId: client.id,
            phone: client.phone,
            message: randomMessage,
            status: "failed",
            error: err.message,
          }).save();
        }
      }

      return { sentCount, failedCount, errors };
    };

    // Send initial batch
    const batches = [];
    for (let index = 0; index < clients.length; index += batchSize) {
      batches.push(clients.slice(index, index + batchSize));
    }

    let sentCount = 0;
    let failedCount = 0;
    const errors = [];
    for (const [index, batch] of batches.entries()) {
      trace("message.broadcast.batch.start", {
        requestId: req.requestId || null,
        userId,
        batchIndex: index + 1,
        batchSize: batch.length,
      });
      const result = await sendBatch(batch);
      sentCount += result.sentCount;
      failedCount += result.failedCount;
      errors.push(...result.errors);
      trace("message.broadcast.batch.done", {
        requestId: req.requestId || null,
        userId,
        batchIndex: index + 1,
        sentCount: result.sentCount,
        failedCount: result.failedCount,
      });
      if (index < batches.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    if (repeatIntervalMs && repeatIntervalMs > 0) {
      await startSchedule(scheduleId, userPhone, repeatIntervalMs);
      trace("message.broadcast.schedule_started", {
        requestId: req.requestId || null,
        userId,
        scheduleId,
      });
    }
    trace("message.broadcast.response", {
      requestId: req.requestId || null,
      userId,
      total: clients.length,
      sentCount,
      failedCount,
      scheduleId: scheduleId || null,
    });

    return res.status(200).json({
      success: true,
      message: repeatIntervalMs
        ? "Messages scheduled successfully"
        : "Message batch sent successfully",
      total: clients.length,
      sentCount,
      failedCount,
      errors,
      scheduleId: scheduleId || null,
    });
  } catch (error) {
    trace("message.broadcast.error", {
      requestId: req.requestId || null,
      userId,
      error: error.message,
      statusCode: error.statusCode || 500,
    }, error.statusCode && error.statusCode < 500 ? "warn" : "error");
    logger.error(`sendRandomMessages error: ${error}`);
    return sendError(res, error);
  }
};

exports.getMessageHistory = async (req, res) => {
  const userId = req.user.id;
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
  const where = { userId };

  if (req.query.phone) {
    where.phone = normalizePhoneNumber(req.query.phone);
  }

  if (req.query.status) {
    where.status = req.query.status;
  }

  if (req.query.search) {
    where.message = { [Op.like]: `%${req.query.search}%` };
  }

  try {
    const { rows, count } = await WhatsAppMessage.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      offset: (page - 1) * limit,
      limit,
    });

    return res.json({
      success: true,
      messages: rows,
      total: count,
      page,
      totalPages: Math.ceil(count / limit),
    });
  } catch (error) {
    logger.error(`Error fetching message history: ${error}`);
    return sendError(res, error);
  }
};

exports.createTemplate = async (req, res) => {
  const { name, body, variables = [] } = req.body;

  if (!name || !body) {
    return res.status(400).json({
      success: false,
      error: "Template name and body are required",
    });
  }

  try {
    const template = await MessageTemplate.create({
      userId: req.user.id,
      name,
      body,
      variables,
    });

    return res.status(201).json({
      success: true,
      message: "Template created successfully",
      template,
    });
  } catch (error) {
    logger.error(`Error creating template: ${error}`);
    return sendError(res, error);
  }
};

exports.getTemplates = async (req, res) => {
  try {
    const templates = await MessageTemplate.findAll({
      where: { userId: req.user.id },
      order: [["createdAt", "DESC"]],
    });

    return res.json({
      success: true,
      templates,
    });
  } catch (error) {
    logger.error(`Error fetching templates: ${error}`);
    return sendError(res, error);
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const template = await MessageTemplate.findOne({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!template) {
      return res.status(404).json({ success: false, error: "Template not found" });
    }

    ["name", "body", "variables"].forEach((field) => {
      if (req.body[field] !== undefined) template[field] = req.body[field];
    });
    await template.save();

    return res.json({ success: true, message: "Template updated", template });
  } catch (error) {
    logger.error(`Error updating template: ${error}`);
    return sendError(res, error);
  }
};

exports.deleteTemplate = async (req, res) => {
  try {
    const template = await MessageTemplate.findOne({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!template) {
      return res.status(404).json({ success: false, error: "Template not found" });
    }

    await template.destroy();
    return res.json({ success: true, message: "Template deleted" });
  } catch (error) {
    logger.error(`Error deleting template: ${error}`);
    return sendError(res, error);
  }
};

// New endpoint to pause/resume scheduled messages
exports.toggleSchedule = async (req, res) => {
  const { scheduleId, action } = req.body; // action: 'pause' or 'resume'
  const userId = req.user.id;

  if (!scheduleId || !["pause", "resume"].includes(action)) {
    return res
      .status(400)
      .json({
        success: false,
        error: "Schedule ID and valid action (pause/resume) are required",
      });
  }

  try {
    const schedule = await ScheduledMessage.findOne({
      where: {
        id: scheduleId,
        userId,
      },
    });
    if (!schedule) {
      return res
        .status(404)
        .json({ success: false, error: "Schedule not found" });
    }

    schedule.status = action === "pause" ? "paused" : "active";
    await schedule.save();

    if (action === "pause") {
      pauseSchedule(schedule.id);
    } else {
      await startSchedule(schedule.id, req.user.phone);
    }

    return res.status(200).json({
      success: true,
      message: `Schedule ${action}d successfully`,
    });
  } catch (error) {
    logger.error(`Error toggling schedule: ${error}`);
    return sendError(res, error);
  }
};

// New endpoint to get all schedules for a user
exports.getSchedules = async (req, res) => {
  const userId = req.user.id;

  try {
    const schedules = await ScheduledMessage.findAll({
      where: { userId },
      attributes: [
        "id",
        "phoneNumbers",
        "messagePool",
        "intervalMs",
        "repeatCount",
        "sentCount",
        "status",
        "lastSent",
        "createdAt",
      ],
    });
    return res.status(200).json({
      success: true,
      message: "Schedules fetched successfully",
      schedules,
    });
  } catch (error) {
    logger.error(`Error fetching schedules: ${error}`);
    return sendError(res, error);
  }
};
