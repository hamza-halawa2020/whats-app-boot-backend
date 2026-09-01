const { authenticateUser } = require("../services/authService");
const User = require("../models/User");
const { Op } = require("sequelize");
const { createAndSendOtp, verifyUserOtp } = require("../services/otpService");
const logger = require("../utils/logger");
const { sendError } = require("../utils/responses");
const { trace } = require("../utils/trace");
const { normalizePhoneNumber } = require("../utils/phone");

const normalizeExistingAccountPhone = (phone) =>
  String(phone || "").trim().startsWith("+")
    ? normalizePhoneNumber(phone)
    : String(phone || "").trim().replace(/[^0-9]/g, "");

const buildUsername = (username, name, email, phone) => {
  const source = username || name || email?.split("@")[0] || phone || "user";
  return source
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 24);
};

exports.signup = async (req, res) => {
  try {
    const { username, name, email, password, phone, countryCode } = req.body;
    const normalizedPhone = phone ? normalizePhoneNumber(phone, countryCode) : null;
    const normalizedEmail = email ? email.trim().toLowerCase() : null;
    trace("auth.signup.request", {
      requestId: req.requestId || null,
      email: normalizedEmail || null,
      phone: normalizedPhone || null,
      countryCode: countryCode || null,
      hasPassword: Boolean(password),
    });

    if (!name || !password || !normalizedPhone) {
      trace("auth.signup.validation_failed", {
        requestId: req.requestId || null,
        hasName: Boolean(name),
        hasPassword: Boolean(password),
        hasPhone: Boolean(normalizedPhone),
      }, "warn");
      return res.status(400).json({
        error: "Name, WhatsApp phone, and password are required",
      });
    }

    let user = await User.findOne({
      where: {
        [Op.or]: [
          { phone: normalizedPhone },
          ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
        ],
      },
    });

    if (user?.isVerified) {
      return res.status(409).json({
        success: false,
        error: "An account with this phone already exists",
      });
    }

    const generatedUsername = `${buildUsername(username, name, normalizedEmail, normalizedPhone)}${Date.now()
      .toString()
      .slice(-6)}`.slice(0, 30);

    if (user) {
      user.username = user.username || generatedUsername;
      user.email = normalizedEmail || user.email || null;
      user.password = password;
      user.phone = normalizedPhone;
      user.isVerified = false;
      await user.save();
    } else {
      user = await User.create({
        username: generatedUsername,
        email: normalizedEmail,
        password,
        phone: normalizedPhone,
        isVerified: false,
      });
    }

    const otpResult = await createAndSendOtp(user);
    trace("auth.signup.user_created", {
      requestId: req.requestId || null,
      userId: user.id,
      email: user.email || null,
      phone: user.phone,
      otpDeliveryMode: otpResult.delivery.mode,
    });

    res.status(201).json({
      success: true,
      message: "Account created successfully. Enter the OTP sent to your WhatsApp.",
      user,
      otpExpiresAt: otpResult.otp.expiresAt,
      otpDebugCode: otpResult.debugCode,
    });
  } catch (error) {
    trace("auth.signup.error", {
      requestId: req.requestId || null,
      error: error.message,
    }, "error");
    logger.error(`API Registration error: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { phone, code, countryCode } = req.body;

    if (!phone || !code || !/^\d{6}$/.test(String(code))) {
      return res.status(400).json({
        success: false,
        error: "Phone and 6-digit verification code are required",
      });
    }

    const result = await verifyUserOtp({ phone, code, countryCode });

    return res.json({
      success: true,
      message: result.alreadyVerified
        ? "Account already verified"
        : "Account verified successfully. You can sign in now.",
      user: result.user,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.resendOtp = async (req, res) => {
  try {
    const { phone, countryCode } = req.body;
    const normalizedPhone = phone
      ? countryCode
        ? normalizePhoneNumber(phone, countryCode)
        : normalizeExistingAccountPhone(phone)
      : null;

    if (!normalizedPhone) {
      return res.status(400).json({
        success: false,
        error: "WhatsApp phone is required",
      });
    }

    const user = await User.findOne({ where: { phone: normalizedPhone } });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "Account not found",
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        error: "Account is already verified",
      });
    }

    const otpResult = await createAndSendOtp(user);

    return res.json({
      success: true,
      message: "A new OTP was sent to your WhatsApp.",
      otpExpiresAt: otpResult.otp.expiresAt,
      otpDebugCode: otpResult.debugCode,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.login = async (req, res) => {
  try {
    const { email, phone, password } = req.body;
    trace("auth.login.request", {
      requestId: req.requestId || null,
      email: email || null,
      phone: phone || null,
      hasPassword: Boolean(password),
    });
    const user = await authenticateUser(email || phone, password);
    trace("auth.login.authenticated", {
      requestId: req.requestId || null,
      userId: user.id,
      phone: user.phone || null,
    });
    const token = await user.generateAuthToken();
    trace("auth.login.token_created", {
      requestId: req.requestId || null,
      userId: user.id,
    });

    res.json({ user, token });
  } catch (error) {
    trace("auth.login.error", {
      requestId: req.requestId || null,
      email: req.body?.email || null,
      phone: req.body?.phone || null,
      error: error.message,
    }, "warn");
    logger.error(`API Login error: ${error.message}`);
    res.status(error.statusCode || 401).json({ error: error.message });
  }
};

exports.logout = async (req, res) => {
  try {
    trace("auth.logout.request", {
      requestId: req.requestId || null,
      userId: req.user?.id || null,
    });
    req.user.tokens = (req.user.tokens || []).filter(
      (tokenObj) => tokenObj.token !== req.token
    );
    await req.user.save();
    trace("auth.logout.success", {
      requestId: req.requestId || null,
      userId: req.user?.id || null,
    });
    res.json({ message: "Logged out successfully" });
  } catch (error) {
    trace("auth.logout.error", {
      requestId: req.requestId || null,
      userId: req.user?.id || null,
      error: error.message,
    }, "error");
    logger.error(`API Logout error: ${error.message}`);
    sendError(res, error);
  }
};

exports.me = async (req, res) => {
  return res.json({
    success: true,
    user: req.user,
  });
};
