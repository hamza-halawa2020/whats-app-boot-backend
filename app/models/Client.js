const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    trim: true
  },
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

clientSchema.methods.toJSON = function () {
  const client = this.toObject();
  delete client.__v;

  return client;
};

module.exports = mongoose.model('Client', clientSchema);