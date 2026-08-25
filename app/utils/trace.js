const logger = require("./logger");
const { randomUUID } = require("crypto");

const SENSITIVE_KEYS = new Set([
  "authorization",
  "password",
  "token",
  "apitoken",
  "apiToken",
  "x-api-token",
]);

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

const summarizeObject = (value = {}) => {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.keys(value).reduce((summary, key) => {
    const normalizedKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(normalizedKey)) {
      summary[key] = "[REDACTED]";
      return summary;
    }

    const item = value[key];
    if (Array.isArray(item)) {
      summary[key] = { type: "array", length: item.length };
      return summary;
    }

    if (item && typeof item === "object") {
      summary[key] = { type: "object", keys: Object.keys(item) };
      return summary;
    }

    summary[key] = item;
    return summary;
  }, {});
};

const traceHttpRequests = (req, res, next) => {
  const shouldTrace =
    req.originalUrl?.startsWith("/api/") ||
    req.originalUrl?.startsWith("/admin/") ||
    ["/health", "/usage", "/rate-limits"].includes(req.originalUrl);

  if (!shouldTrace) {
    return next();
  }

  const startedAt = Date.now();
  req.requestId = req.header("X-Request-Id") || randomUUID();
  res.set("X-Request-Id", req.requestId);

  trace("http.request", {
    requestId: req.requestId,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    body: summarizeObject(req.body || {}),
    query: summarizeObject(req.query || {}),
    hasBearerToken: Boolean(req.header("Authorization")),
    hasApiToken: Boolean(req.header("X-API-Token")),
  });

  res.on("finish", () => {
    trace("http.response", {
      requestId: req.requestId,
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
  summarizeObject,
};
