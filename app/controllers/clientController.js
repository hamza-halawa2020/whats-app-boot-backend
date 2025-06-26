const Client = require("../models/Client");
const logger = require("../utils/logger");

// Add Client
exports.addClient = async (req, res) => {
  try {
    let { phone } = req.body;
    if (!phone) {
      logger.error("Missing phone");
      return res.status(400).json({ error: "Phone is required" });
    }

    const existingClient = await Client.findOne({
      phone,
      addedBy: req.user._id,
    });
    if (existingClient) {
      return res
        .status(400)
        .json({ error: "Client already exists with this phone number" });
    }

    const client = new Client({ phone, addedBy: req.user._id });
    await client.save();

    logger.info(`Client added: ${phone}`);
    res.status(201).json({ message: "Client added successfully", client });
  } catch (error) {
    logger.error(`Error adding client: ${error.message}`);
    res.status(500).json({ error: "Server error" });
  }
};

// Get All Clients for Current User
exports.getAllClients = async (req, res) => {
  try {
    const page = parseInt(req.query.page);
    const limit = parseInt(req.query.limit);

    if (!limit || limit === 0) {
      const clients = await Client.find({ addedBy: req.user._id });
      return res.status(200).json({
        clients,
        total: clients.length,
        page: 1,
        totalPages: 1,
      });
    }

    const skip = (page - 1) * limit;

    const [clients, total] = await Promise.all([
      Client.find({ addedBy: req.user._id }).skip(skip).limit(limit),
      Client.countDocuments({ addedBy: req.user._id }),
    ]);

    res.status(200).json({
      clients,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    logger.error(`Error fetching clients: ${error.message}`);
    res.status(500).json({ error: "Server error" });
  }
};



// Update Client
exports.updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "Phone is required" });
    }

    // Check if the phone already exists for this user (excluding current client)
    const duplicate = await Client.findOne({
      phone,
      addedBy: req.user._id,
      _id: { $ne: id },
    });
    if (duplicate) {
      return res
        .status(400)
        .json({ error: "Another client already has this phone number" });
    }

    const client = await Client.findOneAndUpdate(
      { _id: id, addedBy: req.user._id },
      { phone },
      { new: true }
    );

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    res.status(200).json({ message: "Client updated successfully", client });
  } catch (error) {
    logger.error(`Error updating client: ${error.message}`);
    res.status(500).json({ error: "Server error" });
  }
};

// Delete Client
exports.deleteClient = async (req, res) => {
  try {
    const { id } = req.params;

    const client = await Client.findOneAndDelete({
      _id: id,
      addedBy: req.user._id,
    });

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    res.status(200).json({ message: "Client deleted successfully" });
  } catch (error) {
    logger.error(`Error deleting client: ${error.message}`);
    res.status(500).json({ error: "Server error" });
  }
};
