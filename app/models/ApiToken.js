const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const apiTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    default: () => uuidv4(),
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  phone: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('ApiToken', apiTokenSchema);