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
  if (!process.env.DB_NAME || !process.env.DB_USER) {
    logger.error("MySQL connection error: DB_NAME and DB_USER are required");
    process.exit(1);
  }

  const maxAttempts = Number(process.env.DB_CONNECT_RETRIES || 10);
  const retryDelayMs = Number(process.env.DB_CONNECT_RETRY_DELAY_MS || 3000);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sequelize.authenticate();
      await sequelize.sync();
      await ensureSchemaUpdates(sequelize);
      logger.info("MySQL connected successfully");
      return;
    } catch (error) {
      logger.error(
        `MySQL connection error: ${error.message} (attempt ${attempt}/${maxAttempts})`
      );

      if (attempt === maxAttempts) {
        process.exit(1);
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
};

module.exports = {
  sequelize,
  connectDB,
};
