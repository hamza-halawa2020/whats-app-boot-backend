const AuditLog = require("../models/AuditLog");
const logger = require("../utils/logger");

module.exports = (req, res, next) => {
  res.on("finish", async () => {
    if (!req.user || req.path === "/health") {
      return;
    }

    try {
      await AuditLog.create({
        userId: req.user.id,
        action: `${req.method} ${req.originalUrl}`,
        metadata: {
          statusCode: res.statusCode,
        },
        ipAddress: req.ip,
      });
    } catch (error) {
      logger.error(`Audit log write failed: ${error}`);
    }
  });

  next();
};
