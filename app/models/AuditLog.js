const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");
const User = require("./User");

const AuditLog = sequelize.define(
  "AuditLog",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    action: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {},
    },
    ipAddress: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "audit_logs",
    timestamps: false,
  }
);

AuditLog.belongsTo(User, { as: "user", foreignKey: "userId" });
User.hasMany(AuditLog, { as: "auditLogs", foreignKey: "userId" });

module.exports = AuditLog;
