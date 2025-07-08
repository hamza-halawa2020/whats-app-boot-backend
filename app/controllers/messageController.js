const {
  initializeWhatsApp,
  getWhatsAppClient,
} = require("../services/whatsappService");
const logger = require("../utils/logger");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const Client = require("../models/Client");
const ApiToken = require("../models/ApiToken");

const ScheduledMessage = require("../models/ScheduledMessage");

exports.sendMessage = async (req, res) => {
  let { phone, message } = req.body; 

  if (!phone || !message) {
    return res.status(400).json({
      success: false,
      error: "Phone and message are required",
    });
  }

  try {
    phone = phone.trim().replace(/[^0-9]/g, "");

    let client = await Client.findOne({ phone, addedBy: req.user._id });
    if (!client) {
      client = new Client({ phone, addedBy: req.user._id });
      await client.save();
    }

    let whatsapp = getWhatsAppClient(req.user._id, req.user.phone);
    if (!whatsapp) {
      whatsapp = await initializeWhatsApp(req.user._id, req.user.phone);
    }

    if (!whatsapp || !whatsapp.info) {
      return res.status(400).json({
        success: false,
        error: "WhatsApp client is not ready",
      });
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
    logger.error(`Error sending message: ${error}`);
    return res.status(500).json({
      success: false,
      error: error.message,
      fullError: error.toString(),
    });
  }
};

exports.generateApiToken = async (req, res) => {
  const userId = req.user._id;
  const userPhone = req.user.phone;

  try {
    // Check if user has a WhatsApp client ready
    let whatsapp = getWhatsAppClient(userId, userPhone);
    if (!whatsapp) {
      whatsapp = await initializeWhatsApp(userId, userPhone);
    }

    if (!whatsapp || !whatsapp.info) {
      return res.status(400).json({
        success: false,
        error:
          "WhatsApp client is not ready. Please connect your WhatsApp account.",
      });
    }

    // Create new API token
    const apiToken = new ApiToken({
      user: userId,
      phone: userPhone,
    });
    await apiToken.save();

    return res.status(200).json({
      success: true,
      message: "API token generated successfully",
      token: apiToken.token,
    });
  } catch (error) {
    logger.error(`Error generating API token: ${error}`);
    return res.status(500).json({
      success: false,
      error: error.message,
      fullError: error.toString(),
    });
  }
};

exports.sendMessageWithApiToken = async (req, res) => {
  let { phone, message } = req.body;

  if (!phone || !message) {
    return res.status(400).json({
      success: false,
      error: "Phone and message are required",
    });
  }

  try {
    phone = phone.trim().replace(/[^0-9]/g, "");

    let client = await Client.findOne({ phone, addedBy: req.user._id });
    if (!client) {
      client = new Client({ phone, addedBy: req.user._id });
      await client.save();
    }

    let whatsapp = getWhatsAppClient(req.user._id, req.user.phone);
    if (!whatsapp) {
      whatsapp = await initializeWhatsApp(req.user._id, req.user.phone);
    }

    if (!whatsapp || !whatsapp.info) {
      return res.status(400).json({
        success: false,
        error: "WhatsApp client is not ready",
      });
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
    logger.error(`Error sending message with API token: ${error}`);
    return res.status(500).json({
      success: false,
      error: error.message,
      fullError: error.toString(),
    });
  }
};

exports.getApiTokens = async (req, res) => {
  const userId = req.user._id;

  try {
    const tokens = await ApiToken.find({ user: userId }).select(
      "token phone createdAt"
    );
    return res.status(200).json({
      success: true,
      message: "API tokens fetched successfully",
      tokens,
    });
  } catch (error) {
    logger.error(`Error fetching API tokens: ${error}`);
    return res.status(500).json({
      success: false,
      error: error.message,
      fullError: error.toString(),
    });
  }
};

exports.revokeApiToken = async (req, res) => {
  const userId = req.user._id;
  const { tokenId } = req.body;

  if (!tokenId) {
    return res.status(400).json({
      success: false,
      error: "Token ID is required",
    });
  }

  try {
    const token = await ApiToken.findOneAndDelete({
      _id: tokenId,
      user: userId,
    });
    if (!token) {
      return res.status(404).json({
        success: false,
        error: "Token not found or not authorized",
      });
    }

    return res.status(200).json({
      success: true,
      message: "API token revoked successfully",
    });
  } catch (error) {
    logger.error(`Error revoking API token: ${error}`);
    return res.status(500).json({
      success: false,
      error: error.message,
      fullError: error.toString(),
    });
  }
};

exports.sendRandomMessages = async (req, res) => {
  const {
    messagePool,
    phoneNumbers, // Array of specific phone numbers (optional, replaces clientIds)
    batchSize = 10,
    intervalMs = 5000, // Interval between batches
    repeatIntervalMs, // Interval for repeating messages (e.g., every 1 hour)
    repeatCount = 0, // Number of times to repeat (0 for indefinite)
  } = req.body;
  const userId = req.user._id;
  const userPhone = req.user.phone;

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
      return res
        .status(400)
        .json({ success: false, error: "Phone numbers are required" });
    }

    // Validate and clean phone numbers
    const cleanedPhoneNumbers = phoneNumbers.map((phone) =>
      phone.trim().replace(/[^0-9]/g, "")
    );
    if (cleanedPhoneNumbers.some((phone) => !phone)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid phone number format" });
    }

    // Save or update clients
    const clients = [];
    for (const phone of cleanedPhoneNumbers) {
      let client = await Client.findOne({ phone, addedBy: userId });
      if (!client) {
        client = new Client({ phone, addedBy: userId });
        await client.save();
      }
      clients.push(client);
    }

    // Initialize WhatsApp client
    let whatsapp = getWhatsAppClient(userId, userPhone);
    if (!whatsapp) {
      whatsapp = await initializeWhatsApp(userId, userPhone);
    }

    if (!whatsapp || !whatsapp.info) {
      return res
        .status(400)
        .json({ success: false, error: "WhatsApp client is not ready" });
    }

    // Save scheduling details if repeatIntervalMs is provided
    let scheduleId;
    if (repeatIntervalMs && repeatIntervalMs > 0) {
      const scheduledMessage = new ScheduledMessage({
        user: userId,
        phoneNumbers: cleanedPhoneNumbers,
        messagePool: messages,
        intervalMs: repeatIntervalMs,
        repeatCount,
      });
      await scheduledMessage.save();
      scheduleId = scheduledMessage._id;
    }

    // Function to send a batch of messages
    const sendBatch = async (clientsToSend, isScheduled = false) => {
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
          await whatsapp.sendMessage(chatId, randomMessage);
          await new WhatsAppMessage({
            user: userId,
            client: client._id,
            phone: client.phone,
            message: randomMessage,
          }).save();
          sentCount++;
        } catch (err) {
          failedCount++;
          errors.push({ phone: client.phone, error: err.message });
          logger.error(`Error sending to ${client.phone}: ${err}`);
        }
      }

      return { sentCount, failedCount, errors };
    };

    // Send initial batch
    const { sentCount, failedCount, errors } = await sendBatch(clients);

    // Schedule repeated messages if repeatIntervalMs is provided
    if (repeatIntervalMs && repeatIntervalMs > 0) {
      const scheduleMessages = async () => {
        const schedule = await ScheduledMessage.findById(scheduleId);
        if (!schedule || schedule.status !== "active") return;

        // Check repeat count
        if (
          schedule.repeatCount > 0 &&
          schedule.sentCount >= schedule.repeatCount
        ) {
          schedule.status = "completed";
          await schedule.save();
          return;
        }

        const {
          sentCount: batchSent,
          failedCount: batchFailed,
          errors: batchErrors,
        } = await sendBatch(clients, true);
        schedule.sentCount += batchSent;
        schedule.lastSent = new Date();
        await schedule.save();

        if (batchErrors.length) {
          logger.error(
            `Scheduled batch errors: ${JSON.stringify(batchErrors)}`
          );
        }

        // Schedule next batch
        if (schedule.status === "active") {
          setTimeout(scheduleMessages, repeatIntervalMs);
        }
      };

      // Start scheduling
      setTimeout(scheduleMessages, repeatIntervalMs);
    }

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
    logger.error(`sendRandomMessages error: ${error}`);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// New endpoint to pause/resume scheduled messages
exports.toggleSchedule = async (req, res) => {
  const { scheduleId, action } = req.body; // action: 'pause' or 'resume'
  const userId = req.user._id;

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
      _id: scheduleId,
      user: userId,
    });
    if (!schedule) {
      return res
        .status(404)
        .json({ success: false, error: "Schedule not found" });
    }

    schedule.status = action === "pause" ? "paused" : "active";
    await schedule.save();

    // If resuming, restart the scheduling
    if (action === "resume" && schedule.status === "active") {
      const whatsapp = getWhatsAppClient(userId, req.user.phone);
      if (!whatsapp || !whatsapp.info) {
        return res
          .status(400)
          .json({ success: false, error: "WhatsApp client is not ready" });
      }

      const clients = await Client.find({
        phone: { $in: schedule.phoneNumbers },
        addedBy: userId,
      });
      const sendBatch = async () => {
        const randomMessage =
          schedule.messagePool[
            Math.floor(Math.random() * schedule.messagePool.length)
          ];
        let sentCount = 0;
        for (const client of clients) {
          const chatId = client.phone.endsWith("@c.us")
            ? client.phone
            : `${client.phone}@c.us`;
          try {
            await whatsapp.sendMessage(chatId, randomMessage);
            await new WhatsAppMessage({
              user: userId,
              client: client._id,
              phone: client.phone,
              message: randomMessage,
            }).save();
            sentCount++;
          } catch (err) {
            logger.error(`Error sending to ${client.phone}: ${err}`);
          }
        }
        schedule.sentCount += sentCount;
        schedule.lastSent = new Date();
        await schedule.save();

        if (
          schedule.status === "active" &&
          (schedule.repeatCount === 0 ||
            schedule.sentCount < schedule.repeatCount)
        ) {
          setTimeout(sendBatch, schedule.intervalMs);
        }
      };
      setTimeout(sendBatch, schedule.intervalMs);
    }

    return res.status(200).json({
      success: true,
      message: `Schedule ${action}d successfully`,
    });
  } catch (error) {
    logger.error(`Error toggling schedule: ${error}`);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// New endpoint to get all schedules for a user
exports.getSchedules = async (req, res) => {
  const userId = req.user._id;

  try {
    const schedules = await ScheduledMessage.find({ user: userId }).select(
      "phoneNumbers messagePool intervalMs repeatCount sentCount status lastSent createdAt"
    );
    return res.status(200).json({
      success: true,
      message: "Schedules fetched successfully",
      schedules,
    });
  } catch (error) {
    logger.error(`Error fetching schedules: ${error}`);
    return res.status(500).json({ success: false, error: error.message });
  }
};
