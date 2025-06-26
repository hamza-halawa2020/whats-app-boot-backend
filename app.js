const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const app = express();
const logger = require("./app/utils/logger");
const connectDB = require("./app/config/database");
require("dotenv").config();

app.use(
  cors({
    // origin: "https://hamza.rimansan.net",
    origin: "http://localhost:4200",

    credentials: true,
  })
);

const messageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each user to 100 requests per window
  keyGenerator: (req) => req.user?._id || req.header("X-API-Token") || req.ip,
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

app.use("/api/messages", messageLimiter, messagesRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/clients", clientsRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/groups", groupsRoutes);
app.use("/api/tokens", tokensRoutes);
app.use("/api/external", messageLimiter, externalRoutes);

connectDB();

// Start server
const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  logger.info(`Server started on port ${PORT}`);
});

module.exports = app;
