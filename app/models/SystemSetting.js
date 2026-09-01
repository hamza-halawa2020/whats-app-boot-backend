const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

const SystemSetting = sequelize.define(
  "SystemSetting",
  {
    key: {
      type: DataTypes.STRING(80),
      primaryKey: true,
    },
    value: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    updatedBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "system_settings",
    timestamps: false,
  }
);

module.exports = SystemSetting;
