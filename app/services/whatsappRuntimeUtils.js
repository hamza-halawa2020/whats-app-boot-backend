const path = require("path");

const getSessionId = (userId, phone) => `${userId}_${phone}`;

const getLocalAuthClientId = (sessionId) =>
  sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");

const getLocalAuthDataPath = () =>
  process.env.WWEBJS_AUTH_PATH || path.join(__dirname, "../../.wwebjs_auth");

const getLocalAuthSessionPath = (sessionId) =>
  path.join(
    getLocalAuthDataPath(),
    `session-${getLocalAuthClientId(sessionId)}`
  );

const getChromeExecutablePath = () => {
  const candidates = [
    process.env.CHROME_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);

  const fs = require("fs");
  return candidates.find((candidate) => fs.existsSync(candidate));
};

const getClientState = async (client) => {
  try {
    return await client.getState();
  } catch (error) {
    return null;
  }
};

const isWhatsAppClientUsable = (client) =>
  Boolean(client?.pupPage) &&
  !client.pupPage.isClosed() &&
  (typeof client.pupBrowser?.isConnected !== "function" ||
    client.pupBrowser.isConnected());

const isPuppeteerTargetClosedError = (error) =>
  /Session closed|Target closed|Protocol error/i.test(error?.message || "");

const isPuppeteerNavigationError = (error) =>
  /Execution context was destroyed|Cannot find context with specified id|reading 'AppState'|reading "AppState"/i.test(
    error?.message || ""
  );

const withTimeout = (promise, timeoutMs, timeoutValue) =>
  Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(timeoutValue), timeoutMs)),
  ]);

const normalizeSerializedWid = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (value._serialized) {
    return value._serialized;
  }

  if (value.user && value.server) {
    return `${value.user}@${value.server}`;
  }

  if (value.user) {
    return `${value.user}@c.us`;
  }

  return null;
};

const isLikelyUserWid = (serializedWid) => {
  if (!serializedWid || typeof serializedWid !== "string") {
    return false;
  }

  const [user, server = "c.us"] = serializedWid.split("@");
  return (
    ["c.us", "s.whatsapp.net"].includes(server) &&
    /^\d{6,15}$/.test(user)
  );
};

module.exports = {
  getSessionId,
  getLocalAuthClientId,
  getLocalAuthDataPath,
  getLocalAuthSessionPath,
  getChromeExecutablePath,
  getClientState,
  isWhatsAppClientUsable,
  isPuppeteerTargetClosedError,
  isPuppeteerNavigationError,
  withTimeout,
  normalizeSerializedWid,
  isLikelyUserWid,
};
