const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");
const User = require("./User");
const Client = require("./Client");
const WalletTransaction = require("./WalletTransaction");

const WhatsAppMessage = sequelize.define(
  "WhatsAppMessage",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    clientId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    providerMessageId: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    status: {
      type: DataTypes.ENUM("pending", "sent", "delivered", "read", "played", "failed", "unknown"),
      defaultValue: "sent",
    },
    walletTransactionId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    error: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    deliveredAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "whatsapp_messages",
    timestamps: false,
  }
);

WhatsAppMessage.belongsTo(User, { as: "user", foreignKey: "userId" });
WhatsAppMessage.belongsTo(Client, { as: "client", foreignKey: "clientId" });
WhatsAppMessage.belongsTo(WalletTransaction, {
  as: "walletTransaction",
  foreignKey: "walletTransactionId",
});
User.hasMany(WhatsAppMessage, { as: "messages", foreignKey: "userId" });
Client.hasMany(WhatsAppMessage, { as: "messages", foreignKey: "clientId" });

module.exports = WhatsAppMessage;
