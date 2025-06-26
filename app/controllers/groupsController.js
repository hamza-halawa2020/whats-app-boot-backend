const {
  initializeWhatsApp,
  getWhatsAppClient,
} = require("../services/whatsappService");
const logger = require("../utils/logger");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const Client = require("../models/Client");

exports.getGroups = async (req, res) => {
  const userId = req.user._id;
  const userPhone = req.user.phone;

  try {
    let whatsapp = getWhatsAppClient(userId, userPhone);
    if (!whatsapp) {
      whatsapp = await initializeWhatsApp(userId, userPhone);
    }

    if (!whatsapp || !whatsapp.info) {
      return res.status(400).json({
        success: false,
        error: "WhatsApp client is not ready",
      });
    }

    const chats = await whatsapp.getChats();
    const groups = chats
      .filter((chat) => chat.isGroup)
      .map((chat) => ({
        id: chat.id._serialized,
        name: chat.name || "Unnamed Group",
        participantCount: chat.groupMetadata?.participants.length || 0,
      }));

    return res.status(200).json({
      success: true,
      message: "Groups fetched successfully",
      groups,
    });
  } catch (error) {
    logger.error(`Error fetching groups: ${error}`);
    return res.status(500).json({
      success: false,
      error: error.message,
      fullError: error.toString(),
    });
  }
};

exports.getGroupParticipants = async (req, res) => {
  const userId = req.user._id;
  const userPhone = req.user.phone;
  let { groupId } = req.params;

  if (!groupId) {
    return res.status(400).json({
      success: false,
      error: "Group ID is required",
    });
  }

  // Ensure groupId ends with @g.us
  if (!groupId.endsWith('@g.us')) {
    groupId = `${groupId}@g.us`;
  }

  // Validate groupId format
  const groupIdRegex = /^\d+@g\.us$/;
  if (!groupIdRegex.test(groupId)) {
    return res.status(400).json({
      success: false,
      error: "Invalid group ID format. Must be like '123456789@g.us'",
    });
  }

  try {
    let whatsapp = getWhatsAppClient(userId, userPhone);
    if (!whatsapp) {
      whatsapp = await initializeWhatsApp(userId, userPhone);
    }

    if (!whatsapp || !whatsapp.info) {
      return res.status(400).json({
        success: false,
        error: "WhatsApp client is not ready",
      });
    }

    const chat = await whatsapp.getChatById(groupId);
    if (!chat || !chat.isGroup) {
      return res.status(400).json({
        success: false,
        error: "Invalid group ID or not a group",
      });
    }

    const participants = [];
    let invalidCount = 0;

    for (const participant of chat.groupMetadata?.participants || []) {
      let phone = participant.id.user;
      let isLinkedDevice = participant.id._serialized.endsWith('@lid');

      // Try to get real phone number from contact
      if (isLinkedDevice) {
        try {
          const contact = await whatsapp.getContactById(participant.id._serialized);
          if (contact.number) {
            phone = contact.number;
            isLinkedDevice = false;
          }
        } catch (error) {
          logger.warn(`Could not get contact info for ${participant.id._serialized}: ${error}`);
        }
      }

      participants.push({
        id: participant.id._serialized,
        phone,
        isLinkedDevice,
      });
    }

    // Save participants as Clients
    let addedCount = 0;
    let skippedCount = 0;

    for (const participant of participants) {
      if (participant.isLinkedDevice) {
        invalidCount++;
        continue;
      }

      // Format phone number with country code
      let formattedPhone = participant.phone;
      if (!formattedPhone.startsWith('+')) {
        formattedPhone = `+${formattedPhone}`;
      }

      // Validate phone number format
      const phoneRegex = /^\+\d{10,15}$/;
      if (!phoneRegex.test(formattedPhone)) {
        invalidCount++;
        continue;
      }

      // Check if client already exists
      const existingClient = await Client.findOne({
        phone: formattedPhone,
        addedBy: userId,
      });

      if (!existingClient) {
        // Create new client
        const newClient = new Client({
          phone: formattedPhone,
          addedBy: userId,
        });
        await newClient.save();
        addedCount++;
      } else {
        skippedCount++;
      }
    }

    return res.status(200).json({
      success: true,
      message: "Group participants fetched and processed successfully",
      groupId,
      groupName: chat.name || "Unnamed Group",
      participants,
      addedClients: addedCount,
      skippedClients: skippedCount,
      invalidClients: invalidCount,
    });
  } catch (error) {
    logger.error(`Error fetching group participants for group ${groupId}: ${error}`);
    return res.status(500).json({
      success: false,
      error: error.message,
      fullError: error.toString(),
    });
  }
};