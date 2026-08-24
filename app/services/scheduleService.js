const { Op } = require("sequelize");
const ScheduledMessage = require("../models/ScheduledMessage");
const Client = require("../models/Client");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const User = require("../models/User");
const {
  waitForWhatsAppReady,
  prepareWhatsAppForMessage,
  getSessionId,
} = require("./whatsappService");
const logger = require("../utils/logger");

const timers = new Map();

const clearScheduleTimer = (scheduleId) => {
  const timer = timers.get(scheduleId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(scheduleId);
  }
};

const sendScheduledBatch = async (schedule, userPhone) => {
  const whatsapp = await waitForWhatsAppReady(schedule.userId, userPhone, 30000);
  await prepareWhatsAppForMessage(
    whatsapp,
    getSessionId(schedule.userId, userPhone),
    userPhone
  );

  const clients = await Client.findAll({
    where: {
      phone: { [Op.in]: schedule.phoneNumbers },
      addedBy: schedule.userId,
    },
  });

  let sentCount = 0;

  for (const client of clients) {
    const randomMessage =
      schedule.messagePool[Math.floor(Math.random() * schedule.messagePool.length)];
    const chatId = client.phone.endsWith("@c.us")
      ? client.phone
      : `${client.phone}@c.us`;

    try {
      await whatsapp.sendMessage(chatId, randomMessage, { sendSeen: false });
      await WhatsAppMessage.build({
        userId: schedule.userId,
        clientId: client.id,
        phone: client.phone,
        message: randomMessage,
      }).save();
      sentCount++;
    } catch (error) {
      logger.error(`Scheduled message failed for ${client.phone}: ${error}`);
    }
  }

  return sentCount;
};

const scheduleNextRun = (scheduleId, userPhone, delayMs) => {
  clearScheduleTimer(scheduleId);

  const timer = setTimeout(async () => {
    try {
      const schedule = await ScheduledMessage.findByPk(scheduleId);
      if (!schedule || schedule.status !== "active") {
        clearScheduleTimer(scheduleId);
        return;
      }

      if (schedule.repeatCount > 0 && schedule.sentCount >= schedule.repeatCount) {
        schedule.status = "completed";
        await schedule.save();
        clearScheduleTimer(scheduleId);
        return;
      }

      const sentCount = await sendScheduledBatch(schedule, userPhone);
      schedule.sentCount += sentCount;
      schedule.lastSent = new Date();
      await schedule.save();

      if (schedule.status === "active") {
        scheduleNextRun(schedule.id, userPhone, schedule.intervalMs);
      }
    } catch (error) {
      logger.error(`Schedule ${scheduleId} worker error: ${error}`);
      scheduleNextRun(scheduleId, userPhone, delayMs);
    }
  }, delayMs);

  timers.set(scheduleId, timer);
};

const startSchedule = async (scheduleId, userPhone, delayMs = null) => {
  if (delayMs !== null) {
    scheduleNextRun(scheduleId, userPhone, delayMs);
    return;
  }

  const schedule = await ScheduledMessage.findByPk(scheduleId);
  if (schedule) {
    scheduleNextRun(schedule.id, userPhone, schedule.intervalMs);
  }
};

const pauseSchedule = (scheduleId) => {
  clearScheduleTimer(scheduleId);
};

const resumeActiveSchedules = async () => {
  const schedules = await ScheduledMessage.findAll({
    where: { status: "active" },
    include: [{ model: User, as: "user", attributes: ["phone"] }],
  });

  for (const schedule of schedules) {
    if (schedule.user?.phone) {
      scheduleNextRun(schedule.id, schedule.user.phone, schedule.intervalMs);
    }
  }

  logger.info(`Resumed ${schedules.length} active schedules`);
};

module.exports = {
  startSchedule,
  pauseSchedule,
  resumeActiveSchedules,
};
