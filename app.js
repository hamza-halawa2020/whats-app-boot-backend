const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
require("dotenv").config();
const app = express();
const logger = require("./app/utils/logger");
const { connectDB } = require("./app/config/database");
const { resumeActiveSchedules } = require("./app/services/scheduleService");
const audit = require("./app/middlewares/audit");

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:4200",

    credentials: true,
  })
);

const messageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each user to 100 requests per window
  keyGenerator: (req) => req.user?.id || req.header("X-API-Token") || req.ip,
  message: "Too many message requests, please try again later.",
});

// Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set("view engine", "ejs");

// Routes
const messagesRoutes = require("./app/routes/messages");
const authRoutes = require("./app/routes/auth");
const clientsRoutes = require("./app/routes/clients");
const whatsappRoutes = require("./app/routes/startWhatsapp");
const groupsRoutes = require("./app/routes/groups");
const tokensRoutes = require("./app/routes/tokens");
const externalRoutes = require("./app/routes/external");
const operationsRoutes = require("./app/routes/operations");

app.use(audit);
app.use("/", operationsRoutes);
app.use("/api/messages", messageLimiter, messagesRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/clients", clientsRoutes);
app.use("/api/contacts", clientsRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/groups", groupsRoutes);
app.use("/api/tokens", tokensRoutes);
app.use("/api/external", messageLimiter, externalRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
  });
});

app.use((error, req, res, next) => {
  logger.error(`Unhandled error: ${error}`);
  res.status(error.statusCode || 500).json({
    success: false,
    error: error.statusCode && error.statusCode < 500 ? error.message : "Server error",
  });
});

// Start server
const PORT = process.env.PORT || 3000;

process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled rejection: ${reason?.stack || reason}`);
});

process.on("uncaughtException", (error) => {
  logger.error(`Uncaught exception: ${error?.stack || error}`);
});

const startServer = async () => {
  await connectDB();
  await resumeActiveSchedules();

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    logger.info(`Server started on port ${PORT}`);
  });
};

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
};
