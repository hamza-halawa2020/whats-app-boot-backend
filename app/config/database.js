const { Sequelize } = require("sequelize");
const logger = require("../utils/logger");
const ensureSchemaUpdates = require("./schemaUpdates");

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD || "",
  {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    dialect: "mysql",
    logging: false,
  }
);

const connectDB = async () => {
  try {
    if (!process.env.DB_NAME || !process.env.DB_USER) {
      throw new Error("DB_NAME and DB_USER are required");
    }

    await sequelize.authenticate();
    await sequelize.sync();
    await ensureSchemaUpdates(sequelize);
    logger.info("MySQL connected successfully");
  } catch (error) {
    logger.error(`MySQL connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = {
  sequelize,
  connectDB,
};
