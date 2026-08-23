const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");
const User = require("./User");

const MessageTemplate = sequelize.define(
  "MessageTemplate",
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
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    variables: {
      type: DataTypes.JSON,
      defaultValue: [],
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "message_templates",
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ["userId", "name"],
      },
    ],
  }
);

MessageTemplate.belongsTo(User, { as: "user", foreignKey: "userId" });
User.hasMany(MessageTemplate, { as: "messageTemplates", foreignKey: "userId" });

module.exports = MessageTemplate;
