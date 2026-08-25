const logger = require("./logger");

const safeJson = (payload = {}) => {
  try {
    return JSON.stringify(payload);
  } catch (error) {
    return JSON.stringify({ serializationError: error.message });
  }
};

const trace = (stage, payload = {}, level = "info") => {
  const log = typeof logger[level] === "function" ? logger[level] : logger.info;
  log(`[TRACE] ${stage} ${safeJson(payload)}`);
};

const traceHttpRequests = (req, res, next) => {
  const shouldTrace =
    req.originalUrl?.startsWith("/api/whatsapp") ||
    req.originalUrl?.startsWith("/api/messages");

  if (!shouldTrace) {
    return next();
  }

  const startedAt = Date.now();
  trace("http.request", {
    method: req.method,
    url: req.originalUrl,
    bodyKeys: Object.keys(req.body || {}),
    queryKeys: Object.keys(req.query || {}),
  });

  res.on("finish", () => {
    trace("http.response", {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      userId: req.user?.id || null,
    });
  });

  return next();
};

module.exports = {
  trace,
  traceHttpRequests,
};
