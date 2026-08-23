const {
  waitForWhatsAppReady,
} = require("../services/whatsappService");
const logger = require("../utils/logger");
const Client = require("../models/Client");
const { normalizePhoneNumber } = require("../utils/phone");
const { sendError } = require("../utils/responses");

exports.getGroups = async (req, res) => {
  const userId = req.user.id;
  const userPhone = req.user.phone;

  try {
    const whatsapp = await waitForWhatsAppReady(userId, userPhone);

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
    return sendError(res, error);
  }
};

exports.getGroupParticipants = async (req, res) => {
  const userId = req.user.id;
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
    const whatsapp = await waitForWhatsAppReady(userId, userPhone);

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

      let formattedPhone;
      try {
        formattedPhone = normalizePhoneNumber(participant.phone);
      } catch (error) {
        invalidCount++;
        continue;
      }

      // Check if client already exists
      const existingClient = await Client.findOne({
        where: {
          phone: formattedPhone,
          addedBy: userId,
        },
      });

      if (!existingClient) {
        // Create new client
        const newClient = Client.build({
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
    return sendError(res, error);
  }
};
