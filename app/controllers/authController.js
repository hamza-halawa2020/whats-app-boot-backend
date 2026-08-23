const { authenticateUser } = require("../services/authService");
const User = require("../models/User");
const logger = require("../utils/logger");
const { sendError } = require("../utils/responses");

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

    if (!email || !password || !phone) {
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
    });
    await user.save();

    const token = await user.generateAuthToken();
    res.status(201).json({ user, token });
  } catch (error) {
    logger.error(`API Registration error: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, phone, password } = req.body;
    const user = await authenticateUser(email || phone, password);
    const token = await user.generateAuthToken();

    res.json({ user, token });
  } catch (error) {
    logger.error(`API Login error: ${error.message}`);
    res.status(401).json({ error: error.message });
  }
};

exports.logout = async (req, res) => {
  try {
    req.user.tokens = (req.user.tokens || []).filter(
      (tokenObj) => tokenObj.token !== req.token
    );
    await req.user.save();
    res.json({ message: "Logged out successfully" });
  } catch (error) {
    logger.error(`API Logout error: ${error.message}`);
    sendError(res, error);
  }
};
