const SystemSetting = require("../models/SystemSetting");

const DEFAULT_SETTINGS = {
  signupGiftPoints: Number(process.env.SIGNUP_GIFT_POINTS || 0),
  messagePointCost: Number(process.env.MESSAGE_POINT_COST || 1),
  dailyMessageLimit: Number(process.env.DAILY_MESSAGE_LIMIT || 0),
};

const SETTING_KEY = "app";

const normalizeIntegerSetting = (value, fallback, { min = 0 } = {}) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    return fallback;
  }

  return parsed;
};

const normalizeSettings = (settings = {}) => ({
  signupGiftPoints: normalizeIntegerSetting(
    settings.signupGiftPoints,
    DEFAULT_SETTINGS.signupGiftPoints,
    { min: 0 }
  ),
  messagePointCost: normalizeIntegerSetting(
    settings.messagePointCost,
    DEFAULT_SETTINGS.messagePointCost,
    { min: 1 }
  ),
  dailyMessageLimit: normalizeIntegerSetting(
    settings.dailyMessageLimit,
    DEFAULT_SETTINGS.dailyMessageLimit,
    { min: 0 }
  ),
});

const getAppSettings = async () => {
  const row = await SystemSetting.findByPk(SETTING_KEY);
  return normalizeSettings(row?.value || DEFAULT_SETTINGS);
};

const updateAppSettings = async (updates, adminId = null) => {
  const current = await getAppSettings();
  const next = normalizeSettings({
    ...current,
    ...updates,
  });

  await SystemSetting.upsert({
    key: SETTING_KEY,
    value: next,
    updatedBy: adminId,
    updatedAt: new Date(),
  });

  return next;
};

module.exports = {
  DEFAULT_SETTINGS,
  getAppSettings,
  updateAppSettings,
};
