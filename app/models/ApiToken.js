const { DataTypes } = require("sequelize");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const { sequelize } = require("../config/database");
const User = require("./User");

const ApiToken = sequelize.define(
  "ApiToken",
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
    token: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    userId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    scopes: {
      type: DataTypes.JSON,
      defaultValue: ["messages:send"],
    },
    webhookUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastUsedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "api_tokens",
    timestamps: false,
  }
);

ApiToken.generateRawToken = () => uuidv4();
ApiToken.hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

ApiToken.belongsTo(User, { as: "user", foreignKey: "userId" });
User.hasMany(ApiToken, { as: "apiTokens", foreignKey: "userId" });

module.exports = ApiToken;
