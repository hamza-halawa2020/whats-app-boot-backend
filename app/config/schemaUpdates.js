const columnExists = async (sequelize, tableName, columnName) => {
  const [rows] = await sequelize.query(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    {
      replacements: [tableName, columnName],
    }
  );

  return rows.length > 0;
};

const ensureColumn = async (sequelize, tableName, columnName, definition) => {
  if (await columnExists(sequelize, tableName, columnName)) {
    return;
  }

  await sequelize.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
};

const ensureWalletTransactionsTable = async (sequelize) => {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      userId INT UNSIGNED NOT NULL,
      type ENUM('credit','debit','refund','adjustment') NOT NULL,
      source ENUM('admin','message','broadcast','schedule','payment','system') NOT NULL,
      points INT UNSIGNED NOT NULL,
      balanceBefore INT UNSIGNED NOT NULL,
      balanceAfter INT UNSIGNED NOT NULL,
      messageId INT UNSIGNED NULL,
      adminId INT UNSIGNED NULL,
      note VARCHAR(255) NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX wallet_transactions_user_created (userId, createdAt),
      INDEX wallet_transactions_message (messageId),
      INDEX wallet_transactions_admin (adminId)
    )
  `);
};

const ensureUserOtpsTable = async (sequelize) => {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS user_otps (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      userId INT UNSIGNED NOT NULL,
      phone VARCHAR(255) NOT NULL,
      codeHash VARCHAR(255) NOT NULL,
      expiresAt DATETIME NOT NULL,
      usedAt DATETIME NULL,
      attempts INT UNSIGNED NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX user_otps_user_created (userId, createdAt),
      INDEX user_otps_phone_created (phone, createdAt)
    )
  `);
};

const ensureSystemSettingsTable = async (sequelize) => {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      \`key\` VARCHAR(80) NOT NULL,
      \`value\` JSON NOT NULL,
      updatedBy INT UNSIGNED NULL,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`key\`)
    )
  `);
};

const ensurePointPackagesTable = async (sequelize) => {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS point_packages (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(80) NOT NULL,
      points INT UNSIGNED NOT NULL,
      price DECIMAL(12,2) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
      isActive TINYINT(1) NOT NULL DEFAULT 1,
      createdBy INT UNSIGNED NULL,
      updatedBy INT UNSIGNED NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX point_packages_active (isActive)
    )
  `);
};

const ensurePointPurchasesTable = async (sequelize) => {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS point_purchases (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      userId INT UNSIGNED NOT NULL,
      packageId INT UNSIGNED NULL,
      paymentMethod ENUM('manual','automatic') NOT NULL,
      status ENUM('pending','approved','refused','canceled') NOT NULL DEFAULT 'pending',
      points INT UNSIGNED NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
      proofReference VARCHAR(255) NULL,
      proofFileName VARCHAR(255) NULL,
      proofFileType VARCHAR(80) NULL,
      proofFilePath VARCHAR(500) NULL,
      userNote TEXT NULL,
      adminNote TEXT NULL,
      reviewedBy INT UNSIGNED NULL,
      reviewedAt DATETIME NULL,
      walletTransactionId INT UNSIGNED NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX point_purchases_user_created (userId, createdAt),
      INDEX point_purchases_status_created (status, createdAt),
      INDEX point_purchases_package (packageId),
      INDEX point_purchases_reviewer (reviewedBy),
      INDEX point_purchases_wallet_transaction (walletTransactionId)
    )
  `);

  await ensureColumn(sequelize, "point_purchases", "proofFileName", "VARCHAR(255) NULL");
  await ensureColumn(sequelize, "point_purchases", "proofFileType", "VARCHAR(80) NULL");
  await ensureColumn(sequelize, "point_purchases", "proofFilePath", "VARCHAR(500) NULL");
};

const ensureSchemaUpdates = async (sequelize) => {
  const columns = [
    ["users", "walletPoints", "INT UNSIGNED NOT NULL DEFAULT 0"],
    ["api_tokens", "name", "VARCHAR(255) NULL"],
    ["api_tokens", "scopes", "JSON NULL"],
    ["api_tokens", "webhookUrl", "VARCHAR(255) NULL"],
    ["api_tokens", "expiresAt", "DATETIME NULL"],
    ["api_tokens", "lastUsedAt", "DATETIME NULL"],
    ["clients", "name", "VARCHAR(255) NULL"],
    ["clients", "tags", "JSON NULL"],
    ["clients", "segment", "VARCHAR(255) NULL"],
    ["whatsapp_messages", "providerMessageId", "VARCHAR(255) NULL"],
    [
      "whatsapp_messages",
      "status",
      "ENUM('pending','sent','delivered','read','played','failed','unknown') DEFAULT 'sent'",
    ],
    ["whatsapp_messages", "error", "TEXT NULL"],
    ["whatsapp_messages", "deliveredAt", "DATETIME NULL"],
    ["whatsapp_messages", "readAt", "DATETIME NULL"],
    ["whatsapp_messages", "walletTransactionId", "INT UNSIGNED NULL"],
    ["whatsapp_sessions", "phone", "VARCHAR(255) NULL"],
  ];

  for (const [tableName, columnName, definition] of columns) {
    await ensureColumn(sequelize, tableName, columnName, definition);
  }

  await sequelize.query("ALTER TABLE users MODIFY COLUMN email VARCHAR(255) NULL");
  await ensureWalletTransactionsTable(sequelize);
  await ensureUserOtpsTable(sequelize);
  await ensureSystemSettingsTable(sequelize);
  await ensurePointPackagesTable(sequelize);
  await ensurePointPurchasesTable(sequelize);
};

module.exports = ensureSchemaUpdates;
