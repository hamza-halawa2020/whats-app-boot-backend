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

  await ensureWalletTransactionsTable(sequelize);
};

module.exports = ensureSchemaUpdates;
