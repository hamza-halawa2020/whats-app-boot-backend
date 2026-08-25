const Client = require("../models/Client");
const logger = require("../utils/logger");
const { Op } = require("sequelize");
const { normalizePhoneNumber } = require("../utils/phone");
const { sendError } = require("../utils/responses");
const { trace } = require("../utils/trace");

// Add Client
exports.addClient = async (req, res) => {
  try {
    let { phone, name = null, tags = [], segment = null } = req.body;
    trace("clients.add.request", {
      requestId: req.requestId || null,
      userId: req.user?.id || null,
      phone: phone || null,
      hasName: Boolean(name),
      tagsCount: Array.isArray(tags) ? tags.length : 0,
      segment,
    });
    if (!phone) {
      trace("clients.add.validation_failed", {
        requestId: req.requestId || null,
        reason: "missing_phone",
      }, "warn");
      logger.error("Missing phone");
      return res.status(400).json({ error: "Phone is required" });
    }
    phone = normalizePhoneNumber(phone);
    trace("clients.add.normalized", {
      requestId: req.requestId || null,
      userId: req.user.id,
      phone,
    });

    const existingClient = await Client.findOne({
      where: {
        phone,
        addedBy: req.user.id,
      },
    });
    if (existingClient) {
      trace("clients.add.duplicate", {
        requestId: req.requestId || null,
        userId: req.user.id,
        clientId: existingClient.id,
        phone,
      }, "warn");
      return res
        .status(400)
        .json({ error: "Client already exists with this phone number" });
    }

    const client = Client.build({ phone, name, tags, segment, addedBy: req.user.id });
    await client.save();
    trace("clients.add.created", {
      requestId: req.requestId || null,
      userId: req.user.id,
      clientId: client.id,
      phone,
    });

    logger.info(`Client added: ${phone}`);
    res.status(201).json({ message: "Client added successfully", client });
  } catch (error) {
    logger.error(`Error adding client: ${error.message}`);
    sendError(res, error);
  }
};

// Get All Clients for Current User
exports.getAllClients = async (req, res) => {
  try {
    const page = parseInt(req.query.page);
    const limit = parseInt(req.query.limit);
    const where = { addedBy: req.user.id };
    trace("clients.list.request", {
      requestId: req.requestId || null,
      userId: req.user.id,
      page: page || null,
      limit: limit || null,
      segment: req.query.segment || null,
    });

    if (req.query.segment) {
      where.segment = req.query.segment;
    }

    if (!limit || limit === 0) {
      const clients = await Client.findAll({ where });
      trace("clients.list.response", {
        requestId: req.requestId || null,
        userId: req.user.id,
        total: clients.length,
        paginated: false,
      });
      return res.status(200).json({
        clients,
        total: clients.length,
        page: 1,
        totalPages: 1,
      });
    }

    const skip = (page - 1) * limit;

    const [clients, total] = await Promise.all([
      Client.findAll({ where, offset: skip, limit }),
      Client.count({ where }),
    ]);
    trace("clients.list.response", {
      requestId: req.requestId || null,
      userId: req.user.id,
      total,
      returned: clients.length,
      paginated: true,
    });

    res.status(200).json({
      clients,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    logger.error(`Error fetching clients: ${error.message}`);
    sendError(res, error);
  }
};



// Update Client
exports.updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const { phone, name, tags, segment } = req.body;
    trace("clients.update.request", {
      requestId: req.requestId || null,
      userId: req.user.id,
      clientId: id,
      phone: phone || null,
      fields: Object.keys(req.body || {}),
    });

    if (!phone) {
      trace("clients.update.validation_failed", {
        requestId: req.requestId || null,
        clientId: id,
        reason: "missing_phone",
      }, "warn");
      return res.status(400).json({ error: "Phone is required" });
    }
    const normalizedPhone = normalizePhoneNumber(phone);

    // Check if the phone already exists for this user (excluding current client)
    const duplicate = await Client.findOne({
      where: {
        phone: normalizedPhone,
        addedBy: req.user.id,
        id: { [Op.ne]: id },
      },
    });
    if (duplicate) {
      trace("clients.update.duplicate", {
        requestId: req.requestId || null,
        userId: req.user.id,
        clientId: id,
        duplicateClientId: duplicate.id,
        phone: normalizedPhone,
      }, "warn");
      return res
        .status(400)
        .json({ error: "Another client already has this phone number" });
    }

    const client = await Client.findOne({
      where: { id, addedBy: req.user.id },
    });

    if (!client) {
      trace("clients.update.not_found", {
        requestId: req.requestId || null,
        userId: req.user.id,
        clientId: id,
      }, "warn");
      return res.status(404).json({ error: "Client not found" });
    }

    client.phone = normalizedPhone;
    if (name !== undefined) client.name = name;
    if (tags !== undefined) client.tags = tags;
    if (segment !== undefined) client.segment = segment;
    await client.save();
    trace("clients.update.saved", {
      requestId: req.requestId || null,
      userId: req.user.id,
      clientId: client.id,
      phone: client.phone,
    });

    res.status(200).json({ message: "Client updated successfully", client });
  } catch (error) {
    logger.error(`Error updating client: ${error.message}`);
    sendError(res, error);
  }
};

const parseImportRows = (rows) => {
  if (Array.isArray(rows)) {
    return rows;
  }

  if (typeof rows !== "string") {
    return [];
  }

  return rows
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [phone, name = "", tags = "", segment = ""] = line.split(",");
      return {
        phone,
        name: name || null,
        tags: tags ? tags.split("|").map((tag) => tag.trim()).filter(Boolean) : [],
        segment: segment || null,
      };
    });
};

const previewClientRows = async (userId, rows) => {
  const normalized = [];
  const errors = [];
  const seen = new Set();

  for (const [index, row] of rows.entries()) {
    try {
      const phone = normalizePhoneNumber(row.phone);
      const duplicateInFile = seen.has(phone);
      seen.add(phone);
      const duplicateInDatabase = Boolean(
        await Client.findOne({ where: { phone, addedBy: userId } })
      );

      normalized.push({
        index,
        phone,
        name: row.name || null,
        tags: row.tags || [],
        segment: row.segment || null,
        duplicateInFile,
        duplicateInDatabase,
      });
    } catch (error) {
      errors.push({ index, phone: row.phone, error: error.message });
    }
  }

  return {
    rows: normalized,
    errors,
    validCount: normalized.length,
    duplicateCount: normalized.filter(
      (row) => row.duplicateInFile || row.duplicateInDatabase
    ).length,
  };
};

exports.previewImport = async (req, res) => {
  try {
    const rows = parseImportRows(req.body.rows || req.body.csv);
    trace("clients.import_preview.request", {
      requestId: req.requestId || null,
      userId: req.user.id,
      rowsCount: rows.length,
      source: req.body.rows ? "rows" : "csv",
    });
    const preview = await previewClientRows(req.user.id, rows);
    trace("clients.import_preview.response", {
      requestId: req.requestId || null,
      userId: req.user.id,
      validCount: preview.validCount,
      duplicateCount: preview.duplicateCount,
      errorsCount: preview.errors.length,
    });
    return res.json({ success: true, preview });
  } catch (error) {
    trace("clients.import_preview.error", {
      requestId: req.requestId || null,
      userId: req.user?.id || null,
      error: error.message,
    }, "error");
    logger.error(`Error previewing clients import: ${error.message}`);
    return sendError(res, error);
  }
};

exports.importClients = async (req, res) => {
  try {
    const rows = parseImportRows(req.body.rows || req.body.csv);
    trace("clients.import.request", {
      requestId: req.requestId || null,
      userId: req.user.id,
      rowsCount: rows.length,
      source: req.body.rows ? "rows" : "csv",
    });
    const preview = await previewClientRows(req.user.id, rows);
    let addedCount = 0;
    let skippedCount = 0;

    for (const row of preview.rows) {
      if (row.duplicateInFile || row.duplicateInDatabase) {
        skippedCount++;
        continue;
      }

      await Client.create({
        phone: row.phone,
        name: row.name,
        tags: row.tags,
        segment: row.segment,
        addedBy: req.user.id,
      });
      addedCount++;
    }
    trace("clients.import.response", {
      requestId: req.requestId || null,
      userId: req.user.id,
      addedCount,
      skippedCount,
      errorsCount: preview.errors.length,
    });

    return res.status(201).json({
      success: true,
      message: "Clients imported successfully",
      addedCount,
      skippedCount,
      errors: preview.errors,
    });
  } catch (error) {
    logger.error(`Error importing clients: ${error.message}`);
    return sendError(res, error);
  }
};

// Delete Client
exports.deleteClient = async (req, res) => {
  try {
    const { id } = req.params;
    trace("clients.delete.request", {
      requestId: req.requestId || null,
      userId: req.user.id,
      clientId: id,
    });

    const client = await Client.findOne({
      where: {
        id,
        addedBy: req.user.id,
      },
    });

    if (!client) {
      trace("clients.delete.not_found", {
        requestId: req.requestId || null,
        userId: req.user.id,
        clientId: id,
      }, "warn");
      return res.status(404).json({ error: "Client not found" });
    }

    await client.destroy();
    trace("clients.delete.deleted", {
      requestId: req.requestId || null,
      userId: req.user.id,
      clientId: id,
    });

    res.status(200).json({ message: "Client deleted successfully" });
  } catch (error) {
    logger.error(`Error deleting client: ${error.message}`);
    sendError(res, error);
  }
};
