// models/ScheduledMessage.js
const mongoose = require("mongoose");

const scheduledMessageSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  phoneNumbers: [{ type: String, required: true }], // Array of target phone numbers
  messagePool: [{ type: String, required: true }], // Pool of messages to choose from
  intervalMs: { type: Number, required: true }, // Interval in milliseconds (e.g., 1 hour = 3600000)
  repeatCount: { type: Number, default: 0 }, // 0 means repeat indefinitely
  sentCount: { type: Number, default: 0 }, // Track how many times sent
  status: {
    type: String,
    enum: ["active", "paused", "completed"],
    default: "active",
  },
  lastSent: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("ScheduledMessage", scheduledMessageSchema);
