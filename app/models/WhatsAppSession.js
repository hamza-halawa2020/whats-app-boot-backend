const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");
const User = require("./User");

const WhatsAppSession = sequelize.define(
  "WhatsAppSession",
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
    sessionId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    sessionData: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
    },
    qrCode: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    lastActive: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "whatsapp_sessions",
    timestamps: false,
  }
);

WhatsAppSession.belongsTo(User, { as: "user", foreignKey: "userId" });
User.hasMany(WhatsAppSession, { as: "whatsappSessions", foreignKey: "userId" });

module.exports = WhatsAppSession;
