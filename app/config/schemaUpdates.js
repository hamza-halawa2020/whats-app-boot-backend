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

const ensureSchemaUpdates = async (sequelize) => {
  const columns = [
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
    ["whatsapp_sessions", "phone", "VARCHAR(255) NULL"],
  ];

  for (const [tableName, columnName, definition] of columns) {
    await ensureColumn(sequelize, tableName, columnName, definition);
  }
};

module.exports = ensureSchemaUpdates;
