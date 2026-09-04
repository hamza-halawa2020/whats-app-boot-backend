const crypto = require("crypto");
const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");
const User = require("./User");

const RefreshToken = sequelize.define(
  "RefreshToken",
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
    tokenHash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    revokedAt: {
      type: DataTypes.DATE,
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
    tableName: "refresh_tokens",
    timestamps: true,
  }
);

RefreshToken.hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

RefreshToken.belongsTo(User, { as: "user", foreignKey: "userId" });
User.hasMany(RefreshToken, { as: "refreshTokens", foreignKey: "userId" });

module.exports = RefreshToken;
