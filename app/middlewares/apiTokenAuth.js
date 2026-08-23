const ApiToken = require("../models/ApiToken");
const User = require("../models/User");

module.exports = async (req, res, next) => {
  const token = req.header("X-API-Token");

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "API token is required",
    });
  }

  try {
    const apiToken = await ApiToken.findOne({
      where: { token: ApiToken.hashToken(token) },
      include: [{ model: User, as: "user" }],
    });

    if (!apiToken) {
      return res.status(401).json({
        success: false,
        error: "Invalid API token",
      });
    }

    if (apiToken.expiresAt && new Date(apiToken.expiresAt) <= new Date()) {
      return res.status(401).json({
        success: false,
        error: "API token has expired",
      });
    }

    const scopes = apiToken.scopes || [];
    if (!scopes.includes("messages:send")) {
      return res.status(403).json({
        success: false,
        error: "API token is missing messages:send scope",
      });
    }

    apiToken.lastUsedAt = new Date();
    await apiToken.save();

    req.user = apiToken.user;
    req.user.phone = apiToken.phone;
    req.apiToken = apiToken;
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Server error during token validation",
    });
  }
};
