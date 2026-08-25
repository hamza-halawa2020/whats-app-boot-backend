const { verifyToken } = require('../services/authService');
const { trace } = require("../utils/trace");

const auth = async (req, res, next) => {
  try {
    const authorization = req.header("Authorization");
    if (!authorization || !authorization.startsWith("Bearer ")) {
      throw new Error("Missing authorization header");
    }

    const token = authorization.replace("Bearer ", "");
    const user = await verifyToken(token);
    
    req.user = user;
    req.token = token;
    trace("auth.jwt.success", {
      requestId: req.requestId || null,
      userId: user.id,
      phone: user.phone || null,
      url: req.originalUrl,
    });
    next();
  } catch (error) {
    trace("auth.jwt.failed", {
      requestId: req.requestId || null,
      url: req.originalUrl,
      error: error.message,
    }, "warn");
    res.status(401).json({ error: 'Please authenticate' });
  }
};

module.exports = auth;
