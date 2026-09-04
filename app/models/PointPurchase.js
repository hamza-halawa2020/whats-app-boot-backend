const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");
const PointPackage = require("./PointPackage");
const User = require("./User");
const WalletTransaction = require("./WalletTransaction");

const PointPurchase = sequelize.define(
  "PointPurchase",
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
    packageId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    paymentMethod: {
      type: DataTypes.ENUM("manual", "automatic"),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "approved", "refused", "canceled"),
      allowNull: false,
      defaultValue: "pending",
    },
    points: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    currency: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: "EGP",
    },
    proofReference: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    proofFileName: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    proofFileType: {
      type: DataTypes.STRING(80),
      allowNull: true,
    },
    proofFilePath: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    userNote: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    adminNote: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    reviewedBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    reviewedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    walletTransactionId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "point_purchases",
    timestamps: true,
  }
);

PointPurchase.belongsTo(User, { as: "user", foreignKey: "userId" });
PointPurchase.belongsTo(PointPackage, { as: "package", foreignKey: "packageId" });
PointPurchase.belongsTo(User, { as: "reviewer", foreignKey: "reviewedBy" });
PointPurchase.belongsTo(WalletTransaction, {
  as: "walletTransaction",
  foreignKey: "walletTransactionId",
});

User.hasMany(PointPurchase, { as: "pointPurchases", foreignKey: "userId" });
PointPackage.hasMany(PointPurchase, { as: "purchases", foreignKey: "packageId" });

module.exports = PointPurchase;
