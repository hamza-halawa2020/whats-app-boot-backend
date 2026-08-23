const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");
const User = require("./User");

const Client = sequelize.define(
  "Client",
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
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    tags: {
      type: DataTypes.JSON,
      defaultValue: [],
    },
    segment: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    addedBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "clients",
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ["phone", "addedBy"],
      },
    ],
  }
);

Client.belongsTo(User, { as: "owner", foreignKey: "addedBy" });
User.hasMany(Client, { as: "clients", foreignKey: "addedBy" });

module.exports = Client;
