const { authenticateUser } = require("../services/authService");
const User = require("../models/User");
const logger = require("../utils/logger");
const { sendError } = require("../utils/responses");
const { trace } = require("../utils/trace");

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
    const { username, name, email, password, phone } = req.body;
    trace("auth.signup.request", {
      requestId: req.requestId || null,
      email: email || null,
      phone: phone || null,
      hasPassword: Boolean(password),
    });

    if (!email || !password || !phone) {
      trace("auth.signup.validation_failed", {
        requestId: req.requestId || null,
        hasEmail: Boolean(email),
        hasPassword: Boolean(password),
        hasPhone: Boolean(phone),
      }, "warn");
      return res.status(400).json({
        error: "Email, password, and phone are required",
      });
    }

    const generatedUsername = `${buildUsername(username, name, email, phone)}${Date.now()
      .toString()
      .slice(-6)}`.slice(0, 30);

    const user = User.build({
      username: generatedUsername,
      email,
      password,
      phone,
      isVerified: false,
    });
    await user.save();
    trace("auth.signup.user_created", {
      requestId: req.requestId || null,
      userId: user.id,
      email,
      phone,
    });

    res.status(201).json({
      success: true,
      message: "Account created successfully. Please wait for admin approval.",
      user,
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
