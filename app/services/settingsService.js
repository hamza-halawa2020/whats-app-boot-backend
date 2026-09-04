const SystemSetting = require("../models/SystemSetting");

const DEFAULT_SETTINGS = {
  signupGiftPoints: Number(process.env.SIGNUP_GIFT_POINTS || 0),
  messagePointCost: Number(process.env.MESSAGE_POINT_COST || 1),
  dailyMessageLimit: Number(process.env.DAILY_MESSAGE_LIMIT || 0),
  pointUnitPrice: Number(process.env.POINT_UNIT_PRICE || 1),
  pointCurrency: process.env.POINT_CURRENCY || "EGP",
};

const SETTING_KEY = "app";

const normalizeIntegerSetting = (value, fallback, { min = 0 } = {}) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    return fallback;
  }

  return parsed;
};

const normalizePriceSetting = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Number(parsed.toFixed(2));
};

const normalizeCurrency = (value, fallback = "EGP") => {
  const normalized = String(value || fallback)
    .trim()
    .toUpperCase();

  if (!/^[A-Z]{3,10}$/.test(normalized)) {
    return fallback;
  }

  return normalized;
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
  pointUnitPrice: normalizePriceSetting(
    settings.pointUnitPrice,
    DEFAULT_SETTINGS.pointUnitPrice
  ),
  pointCurrency: normalizeCurrency(settings.pointCurrency, DEFAULT_SETTINGS.pointCurrency),
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
