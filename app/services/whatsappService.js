const { Client } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const WhatsAppSession = require("../models/WhatsAppSession");

const clients = new Map();

const initializeWhatsApp = async (userId, phone) => {
  const sessionId = `${userId}_${phone}`;

  if (clients.has(sessionId)) {
    return clients.get(sessionId);
  }

  const savedSession = await WhatsAppSession.findOne({
    user: userId,
    sessionId,
  });

  const whatsapp = new Client({
    puppeteer: { headless: false },
    session: savedSession ? savedSession.sessionData : undefined,
  });

  whatsapp.on("qr", async (qr) => {
    qrcode.generate(qr, { small: true });
    await WhatsAppSession.updateOne(
      { user: userId, sessionId },
      { qrCode: qr, status: "pending" },
      { upsert: true }
    );
  });

  whatsapp.on("authenticated", async (session) => {
    await WhatsAppSession.updateOne(
      { user: userId, sessionId },
      { sessionData: session, status: "authenticated" },
      { upsert: true }
    );
  });

  whatsapp.on("ready", async () => {
    await WhatsAppSession.updateOne(
      { user: userId, sessionId },
      { status: "ready", lastActive: new Date() }
    );
    console.log(`WhatsApp client ready for user ${userId}`);
  });

  whatsapp.on("disconnected", async () => {
    await WhatsAppSession.updateOne(
      { user: userId, sessionId },
      { status: "disconnected", lastActive: new Date() }
    );
    clients.delete(sessionId);
    whatsapp.destroy();
  });

  await whatsapp.initialize();
  clients.set(sessionId, whatsapp);

  return whatsapp;
};

const getWhatsAppClient = (userId, phone) => {
  const sessionId = `${userId}_${phone}`;
  return clients.get(sessionId);
};

const deleteWhatsAppClient = async (sessionId) => {
  if (clients.has(sessionId)) {
    const client = clients.get(sessionId);
    await client.destroy();
    clients.delete(sessionId);
  }
};
module.exports = {
  initializeWhatsApp,
  getWhatsAppClient,
  deleteWhatsAppClient,
};
