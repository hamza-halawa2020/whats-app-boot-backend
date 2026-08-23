const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");
const User = require("./User");

const ScheduledMessage = sequelize.define(
  "ScheduledMessage",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    _id: {
      type: DataTypes.VIRTUAL,
      get() {
        return this.getDataValue("id");
      },
    },
    userId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    phoneNumbers: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    messagePool: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    intervalMs: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    repeatCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      defaultValue: 0,
    },
    sentCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      defaultValue: 0,
    },
    status: {
      type: DataTypes.ENUM("active", "paused", "completed"),
      defaultValue: "active",
    },
    lastSent: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "scheduled_messages",
    timestamps: false,
  }
);

ScheduledMessage.belongsTo(User, { as: "user", foreignKey: "userId" });
User.hasMany(ScheduledMessage, { as: "scheduledMessages", foreignKey: "userId" });

module.exports = ScheduledMessage;
