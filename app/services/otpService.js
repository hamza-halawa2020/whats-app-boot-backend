const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const User = require("../models/User");
const UserOtp = require("../models/UserOtp");
const WalletTransaction = require("../models/WalletTransaction");
const WhatsAppSession = require("../models/WhatsAppSession");
const {
  initializeWhatsApp,
  getWhatsAppClient,
  prepareWhatsAppForMessage,
  getSessionId,
} = require("./whatsappService");
const { sendTextViaWWebJS } = require("./whatsappDirectSend");
const { normalizePhoneNumber } = require("../utils/phone");
const { trace } = require("../utils/trace");
const { getAppSettings } = require("./settingsService");
const { creditPoints } = require("./walletService");

const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);

const generateOtpCode = () => crypto.randomInt(100000, 1000000).toString();

const normalizeStoredDigits = (phone) =>
  String(phone || "").trim().replace(/[^0-9]/g, "");

const getOtpMessage = (code) =>
  `Your WhatsApp Sender verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`;

const getConfiguredOtpSender = () => {
  let adminPhone = null;
  try {
    adminPhone = process.env.OTP_SENDER_ADMIN_PHONE
      ? normalizePhoneNumber(process.env.OTP_SENDER_ADMIN_PHONE)
      : null;
  } catch (error) {
    adminPhone = null;
  }

  return {
    adminUserId: process.env.OTP_SENDER_USER_ID || null,
    adminPhone,
  };
};

const findOtpSenderSession = async () => {
  const configured = getConfiguredOtpSender();
  const adminWhere = {
    role: "admin",
    isVerified: true,
  };

  if (configured.adminUserId) {
    adminWhere.id = configured.adminUserId;
  }

  const admins = await User.findAll({
    where: adminWhere,
    order: [["createdAt", "ASC"]],
  });

  for (const adminUser of admins) {
    const sessionWhere = {
      userId: adminUser.id,
      status: {
        [Op.in]: ["ready", "authenticated"],
      },
    };

    if (configured.adminPhone) {
      sessionWhere.phone = configured.adminPhone;
    }

    const sessions = await WhatsAppSession.findAll({
      where: sessionWhere,
      order: [["lastActive", "DESC"], ["createdAt", "DESC"]],
    });

    for (const session of sessions) {
      const senderPhone = normalizeStoredDigits(session.phone);
      const sessionId = getSessionId(adminUser.id, senderPhone);
      let whatsapp = getWhatsAppClient(adminUser.id, senderPhone);

      if (!whatsapp) {
        whatsapp = await initializeWhatsApp(adminUser.id, senderPhone);
      }

      await prepareWhatsAppForMessage(whatsapp, sessionId, senderPhone);
      return {
        adminUser,
        senderPhone,
        sessionId,
        whatsapp,
      };
    }
  }

  const error = new Error(
    "Admin WhatsApp OTP sender is not ready. Start an admin WhatsApp session first."
  );
  error.statusCode = 503;
  throw error;
};

const sendOtpToPhone = async ({ phone, code }) => {
  const normalizedPhone = String(phone || "").trim().startsWith("+")
    ? normalizePhoneNumber(phone)
    : normalizeStoredDigits(phone);

  if (process.env.OTP_DELIVERY_MODE === "log") {
    trace("auth.otp.delivery.log", {
      phone: normalizedPhone,
      code,
    });
    return {
      mode: "log",
      senderPhone: null,
    };
  }

  const sender = await findOtpSenderSession();
  const chatId = `${normalizedPhone}@c.us`;
  let registeredWid = null;

  try {
    registeredWid = await sender.whatsapp.getNumberId(chatId);
  } catch (error) {
    trace("auth.otp.number_check_failed", {
      phone: normalizedPhone,
      chatId,
      error: error.message,
    }, "warn");

    const friendlyError = new Error(
      "Could not verify this WhatsApp number. Use the international format, for example 201001234567."
    );
    friendlyError.statusCode = 400;
    throw friendlyError;
  }

  if (!registeredWid) {
    const error = new Error("This phone number is not registered on WhatsApp");
    error.statusCode = 400;
    throw error;
  }

  const result = await sendTextViaWWebJS(
    sender.whatsapp,
    chatId,
    registeredWid._serialized || chatId,
    getOtpMessage(code)
  );

  if (!result?.success) {
    const error = new Error("Could not send OTP on WhatsApp. Please try again.");
    error.statusCode = 424;
    throw error;
  }

  trace("auth.otp.delivery.whatsapp", {
    phone: normalizedPhone,
    senderUserId: sender.adminUser.id,
    senderPhone: sender.senderPhone,
    providerMessageId: result.providerMessageId || null,
  });

  return {
    mode: "whatsapp",
    senderPhone: sender.senderPhone,
    providerMessageId: result.providerMessageId || null,
  };
};

const createAndSendOtp = async (user) => {
  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await UserOtp.update(
    { usedAt: new Date() },
    { where: { userId: user.id, usedAt: null } }
  );

  const otp = await UserOtp.create({
    userId: user.id,
    phone: user.phone,
    codeHash,
    expiresAt,
  });

  const delivery = await sendOtpToPhone({
    phone: user.phone,
    code,
  });

  return {
    otp,
    delivery,
    debugCode: process.env.OTP_DELIVERY_MODE === "log" ? code : undefined,
  };
};

const SIGNUP_GIFT_NOTE = "Signup verification gift";

const applySignupGiftPoints = async (user) => {
  const settings = await getAppSettings();
  const giftPoints = Number(settings.signupGiftPoints || 0);

  if (!giftPoints) {
    return null;
  }

  const existingGift = await WalletTransaction.findOne({
    where: {
      userId: user.id,
      source: "system",
      note: SIGNUP_GIFT_NOTE,
    },
  });

  if (existingGift) {
    return existingGift;
  }

  return creditPoints({
    userId: user.id,
    points: giftPoints,
    source: "system",
    note: SIGNUP_GIFT_NOTE,
  });
};

const getOtpPhoneCandidates = (phone, countryCode = null) => {
  const candidates = new Set();
  const rawPhone = String(phone || "").trim();
  const storedDigits = normalizeStoredDigits(rawPhone);

  if (storedDigits) {
    candidates.add(storedDigits);
  }

  try {
    candidates.add(normalizePhoneNumber(rawPhone, countryCode));
  } catch (error) {
    // Keep the raw digit fallback for existing clients that submit stored phones.
  }

  return [...candidates];
};

const verifyUserOtp = async ({ phone, code, countryCode = null }) => {
  const phoneCandidates = getOtpPhoneCandidates(phone, countryCode);
  let user = await User.findOne({
    where: {
      phone: {
        [Op.in]: phoneCandidates,
      },
    },
  });

  const rawDigits = normalizeStoredDigits(phone);
  if (!user && rawDigits.length >= 6) {
    user = await User.findOne({
      where: {
        phone: {
          [Op.like]: `%${rawDigits}`,
        },
      },
      order: [["createdAt", "DESC"]],
    });
  }

  if (!user) {
    const error = new Error("Invalid verification code");
    error.statusCode = 400;
    throw error;
  }

  if (user.isVerified) {
    return { user, alreadyVerified: true };
  }

  const otp = await UserOtp.findOne({
    where: {
      userId: user.id,
      phone: user.phone,
      usedAt: null,
    },
    order: [["createdAt", "DESC"]],
  });

  if (!otp || otp.expiresAt.getTime() < Date.now()) {
    const error = new Error("Verification code expired. Request a new code.");
    error.statusCode = 400;
    throw error;
  }

  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    const error = new Error("Too many invalid attempts. Request a new code.");
    error.statusCode = 429;
    throw error;
  }

  const isMatch = await bcrypt.compare(String(code || ""), otp.codeHash);
  if (!isMatch) {
    otp.attempts += 1;
    await otp.save();
    const error = new Error("Invalid verification code");
    error.statusCode = 400;
    throw error;
  }

  otp.usedAt = new Date();
  await otp.save();

  user.isVerified = true;
  await user.save();
  await applySignupGiftPoints(user);
  await user.reload();

  return { user, alreadyVerified: false };
};

module.exports = {
  createAndSendOtp,
  verifyUserOtp,
};
