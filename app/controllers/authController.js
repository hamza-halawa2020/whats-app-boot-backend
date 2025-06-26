const { authenticateUser } = require("../services/authService");
const User = require("../models/User");
const logger = require("../utils/logger");

exports.signup = async (req, res) => {
  try {
    const { username, email, password, phone } = req.body;
    const user = new User({ username, email, password, phone });
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
    const { email, password } = req.body;
    const user = await authenticateUser(email, password);
    const token = await user.generateAuthToken();

    res.json({ user, token });
  } catch (error) {
    logger.error(`API Login error: ${error.message}`);
    res.status(401).json({ error: error.message });
  }
};

exports.logout = async (req, res) => {
  try {
    req.user.tokens = req.user.tokens.filter(
      (tokenObj) => tokenObj.token !== req.token
    );
    await req.user.save();
    res.json({ message: "Logged out successfully" });
  } catch (error) {
    logger.error(`API Logout error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
};
