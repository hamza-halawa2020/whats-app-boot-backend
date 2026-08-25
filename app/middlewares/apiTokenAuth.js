const ApiToken = require("../models/ApiToken");
const User = require("../models/User");
const { trace } = require("../utils/trace");

module.exports = async (req, res, next) => {
  const token = req.header("X-API-Token");

  if (!token) {
    trace("auth.api_token.missing", {
      requestId: req.requestId || null,
      url: req.originalUrl,
    }, "warn");
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
      trace("auth.api_token.invalid", {
        requestId: req.requestId || null,
        url: req.originalUrl,
      }, "warn");
      return res.status(401).json({
        success: false,
        error: "Invalid API token",
      });
    }

    if (apiToken.expiresAt && new Date(apiToken.expiresAt) <= new Date()) {
      trace("auth.api_token.expired", {
        requestId: req.requestId || null,
        tokenId: apiToken.id,
        expiresAt: apiToken.expiresAt,
      }, "warn");
      return res.status(401).json({
        success: false,
        error: "API token has expired",
      });
    }

    const scopes = apiToken.scopes || [];
    if (!scopes.includes("messages:send")) {
      trace("auth.api_token.scope_denied", {
        requestId: req.requestId || null,
        tokenId: apiToken.id,
        scopes,
      }, "warn");
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
    trace("auth.api_token.success", {
      requestId: req.requestId || null,
      tokenId: apiToken.id,
      userId: req.user.id,
      phone: apiToken.phone,
      scopes,
      url: req.originalUrl,
    });
    next();
  } catch (error) {
    trace("auth.api_token.error", {
      requestId: req.requestId || null,
      url: req.originalUrl,
      error: error.message,
    }, "error");
    return res.status(500).json({
      success: false,
      error: "Server error during token validation",
    });
  }
};
