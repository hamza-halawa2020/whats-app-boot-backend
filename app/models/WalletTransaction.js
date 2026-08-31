const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");
const User = require("./User");

const WalletTransaction = sequelize.define(
  "WalletTransaction",
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
    type: {
      type: DataTypes.ENUM("credit", "debit", "refund", "adjustment"),
      allowNull: false,
    },
    source: {
      type: DataTypes.ENUM("admin", "message", "broadcast", "schedule", "payment", "system"),
      allowNull: false,
    },
    points: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    balanceBefore: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    balanceAfter: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    messageId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    adminId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    note: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "wallet_transactions",
    timestamps: false,
  }
);

WalletTransaction.belongsTo(User, { as: "user", foreignKey: "userId" });
WalletTransaction.belongsTo(User, { as: "admin", foreignKey: "adminId" });
User.hasMany(WalletTransaction, { as: "walletTransactions", foreignKey: "userId" });

module.exports = WalletTransaction;
