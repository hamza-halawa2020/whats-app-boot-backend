const mongoose = require("mongoose");

const whatsappSessionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  sessionId: {
    type: String,
    required: true,
    unique: true,
  },
  sessionData: {
    type: Object,
    required: true,
  },
  qrCode: String,
  status: String,
  lastActive: Date,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("WhatsAppSession", whatsappSessionSchema);
