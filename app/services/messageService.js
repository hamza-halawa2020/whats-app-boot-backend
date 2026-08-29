const {
  getWhatsAppClient,
  prepareWhatsAppForMessage,
  getSessionId,
} = require("./whatsappService");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const WhatsAppSession = require("../models/WhatsAppSession");
const Client = require("../models/Client");
const { normalizePhoneNumber } = require("../utils/phone");
const { trace } = require("../utils/trace");
const { sendTextViaWWebJS } = require("./whatsappDirectSend");

const addCandidatePhone = (phones, phone) => {
  if (!phone) {
    return;
  }

  try {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!phones.includes(normalizedPhone)) {
      phones.push(normalizedPhone);
    }
  } catch (error) {
    trace("message.service.sender_candidate.invalid", {
      phone,
      error: error.message,
    }, "warn");
  }
};

const getCandidateSenderPhones = async (user, requestedSenderPhone = null) => {
  const phones = [];
  addCandidatePhone(phones, requestedSenderPhone);
  addCandidatePhone(phones, user.phone);

  const sessions = await WhatsAppSession.findAll({
    where: { userId: user.id },
    order: [["lastActive", "DESC"], ["createdAt", "DESC"]],
  });

  sessions.forEach((session) => {
    if (["ready", "authenticated"].includes(session.status)) {
      addCandidatePhone(phones, session.phone);
    }
  });

  return phones;
};

const findActiveWhatsAppClient = async (user, requestedSenderPhone = null) => {
  const candidatePhones = await getCandidateSenderPhones(user, requestedSenderPhone);

  trace("message.service.sender_candidates", {
    userId: user.id,
    requestedSenderPhone,
    candidatePhones,
  });

  for (const senderPhone of candidatePhones) {
    const sessionId = getSessionId(user.id, senderPhone);
    const whatsapp = getWhatsAppClient(user.id, senderPhone);

    trace("message.service.sender_client.lookup", {
      userId: user.id,
      senderPhone,
      sessionId,
      hasClient: Boolean(whatsapp),
      hasInfo: Boolean(whatsapp?.info),
      hasPage: Boolean(whatsapp?.pupPage),
    });

    if (whatsapp) {
      return { whatsapp, senderPhone, sessionId, candidatePhones };
    }
  }

  return { whatsapp: null, senderPhone: null, sessionId: null, candidatePhones };
};

const sendTextMessage = async (whatsapp, chatId, message) => {
  const normalizeProviderMessageId = (id) => {
    if (!id) {
      return null;
    }

    if (typeof id === "string") {
      return id;
    }

    if (typeof id._serialized === "string") {
      return id._serialized;
    }

    if (typeof id.id === "string") {
      return id.id;
    }

    if (id.from && id.to && id.id) {
      return `${id.from}_${id.to}_${id.id}`;
    }

    return null;
  };

  const findSubmittedMessageAfterSerializeFailure = async (
    deliveryChatId,
    providerChatId,
    content,
    sentAfterMs
  ) =>
    whatsapp.pupPage.evaluate(
      async (deliveryChatId, providerChatId, content, sentAfterMs) => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const candidateChatIds = [providerChatId, deliveryChatId].filter(Boolean);
        const sentAfterSeconds = Math.floor((sentAfterMs - 10000) / 1000);

        const getSerialized = (value) => {
          if (!value) {
            return null;
          }

          if (typeof value === "string") {
            return value;
          }

          if (typeof value._serialized === "string") {
            return value._serialized;
          }

          if (value.user && value.server) {
            return `${value.user}@${value.server}`;
          }

          return null;
        };

        const isMatchingMessage = (msg) => {
          const bodyMatches = msg.body === content;
          const isOutgoing = msg.id?.fromMe || msg.fromMe || msg.self === "out";
          const isRecent = !msg.t || msg.t >= sentAfterSeconds;
          const remoteId = getSerialized(msg.id?.remote || msg.to);
          const remoteMatches = !remoteId || candidateChatIds.includes(remoteId);
          return bodyMatches && isOutgoing && isRecent && remoteMatches;
        };

        const serializeMatch = (matchingMessage, chatId, attempt) => ({
          providerMessageId: matchingMessage.id._serialized,
          chatId,
          ack: matchingMessage.ack ?? null,
          attempt,
        });

        for (let attempt = 1; attempt <= 10; attempt++) {
          for (const candidateChatId of candidateChatIds) {
            const chat = await window.WWebJS.getChat(candidateChatId, {
              getAsModel: false,
            });

            if (!chat?.msgs?.getModelsArray) {
              continue;
            }

            const messages = chat.msgs.getModelsArray();
            const matchingMessage = [...messages]
              .reverse()
              .find(isMatchingMessage);

            if (matchingMessage?.id?._serialized) {
              return serializeMatch(matchingMessage, candidateChatId, attempt);
            }
          }

          const storeMessages =
            window.require("WAWebCollections").Msg?.getModelsArray?.() || [];
          const storeMatch = [...storeMessages].reverse().find(isMatchingMessage);
          if (storeMatch?.id?._serialized) {
            return serializeMatch(storeMatch, getSerialized(storeMatch.id.remote), attempt);
          }

          await wait(500);
        }

        return null;
      },
      deliveryChatId,
      providerChatId,
      content,
      sentAfterMs
    );

  const getSendChatIds = (deliveryChatId, providerChatId) => {
    const ids = [];
    if (deliveryChatId) {
      ids.push(deliveryChatId);
    }
    if (providerChatId && providerChatId !== deliveryChatId) {
      ids.push(providerChatId);
    }
    return [...new Set(ids)];
  };

  const registeredWid = await whatsapp.getNumberId(chatId);
  trace("message.service.provider_number_check", {
    chatId,
    isRegistered: Boolean(registeredWid),
    registeredWid: registeredWid?._serialized || null,
  }, registeredWid ? "info" : "warn");

  if (!registeredWid) {
    const error = new Error(`Phone number is not registered on WhatsApp: ${chatId.replace("@c.us", "")}`);
    error.statusCode = 400;
    throw error;
  }

  const providerChatId = registeredWid._serialized || chatId;
  const deliveryChatId = chatId;
  const sendChatIds = getSendChatIds(deliveryChatId, providerChatId);
  trace("message.service.provider_chat_resolved", {
    requestedChatId: chatId,
    providerChatId,
    deliveryChatId,
    sendChatIds,
  });

  const openedChatId = null;

  let sent;
  let mode = "wwebjs_direct";
  let usedChatId = null;
  const sendStartedAt = Date.now();
  const isSerializeError = (error) =>
    /getMessageModel|reading 'serialize'|reading "serialize"/i.test(error?.message || "");

  const tryRecoverAfterSerializeError = async (error, targetChatId) => {
    const recoveredMessage = await findSubmittedMessageAfterSerializeFailure(
      deliveryChatId,
      providerChatId,
      message,
      sendStartedAt
    );

    if (!recoveredMessage?.providerMessageId) {
      return null;
    }

    trace("message.service.provider_send.recovered_after_serialize_error", {
      chatId,
      providerChatId,
      deliveryChatId,
      targetChatId,
      recoveredChatId: recoveredMessage.chatId,
      providerMessageId: recoveredMessage.providerMessageId,
      ack: recoveredMessage.ack,
      attempt: recoveredMessage.attempt,
      error: error.message,
    }, "warn");

    return { id: { _serialized: recoveredMessage.providerMessageId } };
  };

  trace("message.service.provider_send.direct.before", {
    chatId,
    sendChatIds,
    deliveryChatId,
    providerChatId,
  });

  const directResult = await sendTextViaWWebJS(
    whatsapp,
    deliveryChatId,
    providerChatId,
    message
  );
  if (directResult?.success) {
    sent = { id: { _serialized: directResult.providerMessageId } };
    usedChatId = directResult.chatId;
    mode =
      directResult.chatId !== deliveryChatId
        ? "wwebjs_direct_lid"
        : "wwebjs_direct";
    trace("message.service.provider_send.direct.success", {
      chatId,
      usedChatId,
      providerMessageId: directResult.providerMessageId,
      ack: directResult.ack,
      resolveSource: directResult.resolveSource,
      mode,
    });
  } else {
    const recoveredAfterDirect = await findSubmittedMessageAfterSerializeFailure(
      deliveryChatId,
      providerChatId,
      message,
      sendStartedAt
    );

    if (recoveredAfterDirect?.providerMessageId) {
      sent = { id: { _serialized: recoveredAfterDirect.providerMessageId } };
      usedChatId = recoveredAfterDirect.chatId;
      mode = "wwebjs_direct_recovered";
      trace("message.service.provider_send.direct.recovered", {
        chatId,
        usedChatId,
        providerMessageId: recoveredAfterDirect.providerMessageId,
        attempt: recoveredAfterDirect.attempt,
        directErrors: directResult?.errors || [],
      }, "warn");
    } else {
    trace("message.service.provider_send.direct.failed", {
      chatId,
      sendChatIds,
      errors: directResult?.errors || [],
    }, "warn");

    let lastError = null;
    mode = "client_send_message";

    for (let index = 0; index < sendChatIds.length; index++) {
      const targetChatId = sendChatIds[index];
      const isLastAttempt = index === sendChatIds.length - 1;

      try {
        trace("message.service.provider_send.attempt", {
          chatId,
          targetChatId,
          attempt: index + 1,
          totalAttempts: sendChatIds.length,
        });

        sent = await whatsapp.sendMessage(targetChatId, message, {
          sendSeen: false,
        });
        usedChatId = targetChatId;
        if (targetChatId !== deliveryChatId) {
          mode = "client_send_message_lid";
        }

        const fallbackProviderMessageId = normalizeProviderMessageId(sent?.id);
        if (fallbackProviderMessageId) {
          break;
        }

        const recoveredFromFallback = await tryRecoverAfterSerializeError(
          new Error("client_send_message returned without message id"),
          targetChatId
        );
        if (recoveredFromFallback) {
          sent = recoveredFromFallback;
          mode = "client_send_message_recovered";
          break;
        }

        if (!isLastAttempt) {
          trace("message.service.provider_send.retry_next_chat_id", {
            chatId,
            failedChatId: targetChatId,
            nextChatId: sendChatIds[index + 1],
            error: "missing_provider_message_id",
          }, "warn");
          continue;
        }

        lastError = new Error("WhatsApp did not confirm the message was sent.");
        lastError.statusCode = 424;
        break;
      } catch (error) {
        lastError = error;

        if (isSerializeError(error)) {
          const recovered = await tryRecoverAfterSerializeError(error, targetChatId);
          if (recovered) {
            sent = recovered;
            usedChatId = targetChatId;
            mode = "client_send_message_recovered";
            break;
          }
        }

        if (!isLastAttempt) {
          trace("message.service.provider_send.retry_next_chat_id", {
            chatId,
            failedChatId: targetChatId,
            nextChatId: sendChatIds[index + 1],
            error: error.message,
          }, "warn");
          continue;
        }

        if (isSerializeError(error)) {
          const recoveredAfterFailure = await tryRecoverAfterSerializeError(
            error,
            targetChatId
          );
          if (recoveredAfterFailure) {
            sent = recoveredAfterFailure;
            usedChatId = targetChatId;
            mode = "client_send_message_recovered";
            break;
          }

          error.statusCode = 424;
          error.message =
            "WhatsApp sent no confirmation for this message. Try opening the chat once in WhatsApp Web, then send again.";
          trace("message.service.provider_send.unconfirmed_after_serialize_error", {
            chatId,
            providerChatId,
            deliveryChatId,
            sendChatIds,
            directErrors: directResult?.errors || [],
          }, "error");
          throw error;
        }

        trace("message.service.provider_send.failed", {
          chatId,
          providerChatId,
          deliveryChatId,
          targetChatId,
          error: error.message,
        }, "error");
        throw error;
      }
    }

    if (!sent && lastError) {
      throw lastError;
    }
    }
  }

  const providerMessageId = normalizeProviderMessageId(sent?.id);

  trace("message.service.provider_send.confirmed", {
    chatId,
    providerChatId,
    deliveryChatId,
    usedChatId,
    openedChatId,
    providerMessageId,
    mode,
    sentIdType: sent?.id?.constructor?.name || typeof sent?.id,
  });

  if (!providerMessageId) {
    const error = new Error("WhatsApp did not confirm the message was sent.");
    error.statusCode = 424;
    throw error;
  }

  return {
    providerMessageId,
    returnedMessage: true,
    chatId: usedChatId || deliveryChatId,
    providerChatId,
    mode,
  };
};

const sendWhatsAppMessage = async ({ user, phone, message, senderPhone = null }) => {
  const normalizedPhone = normalizePhoneNumber(phone);

  trace("message.service.start", {
    userId: user.id,
    accountPhone: user.phone,
    requestedSenderPhone: senderPhone,
    rawToPhone: phone,
    normalizedToPhone: normalizedPhone,
    messageLength: message?.length || 0,
  });

  let client = await Client.findOne({
    where: {
      phone: normalizedPhone,
      addedBy: user.id,
    },
  });

  if (!client) {
    client = Client.build({ phone: normalizedPhone, addedBy: user.id });
    await client.save();
    trace("message.service.client.created", {
      userId: user.id,
      clientId: client.id,
      phone: normalizedPhone,
    });
  } else {
    trace("message.service.client.found", {
      userId: user.id,
      clientId: client.id,
      phone: client.phone,
    });
  }

  const activeClient = await findActiveWhatsAppClient(user, senderPhone);
  const { whatsapp, senderPhone: resolvedSenderPhone, sessionId } = activeClient;

  trace("message.service.whatsapp_client.lookup", {
    userId: user.id,
    requestedSenderPhone: senderPhone,
    resolvedSenderPhone,
    sessionId,
    hasClient: Boolean(whatsapp),
    hasInfo: Boolean(whatsapp?.info),
    hasPage: Boolean(whatsapp?.pupPage),
    candidatePhones: activeClient.candidatePhones,
  });

  if (!whatsapp) {
    const error = new Error(
      "No active WhatsApp session was found for this user. Start WhatsApp and scan the QR code, or send senderPhone with the scanned phone number."
    );
    error.statusCode = 400;
    throw error;
  }

  trace("message.service.prepare.before", {
    userId: user.id,
    sessionId,
  });

  await prepareWhatsAppForMessage(
    whatsapp,
    sessionId,
    resolvedSenderPhone
  );

  trace("message.service.prepare.after", {
    userId: user.id,
    sessionId,
  });

  const chatId = client.phone.endsWith("@c.us")
    ? client.phone
    : `${client.phone}@c.us`;

  trace("message.service.provider_send.before", {
    userId: user.id,
    sessionId,
    chatId,
  });

  const sentMessage = await sendTextMessage(whatsapp, chatId, message);

  trace("message.service.provider_send.after", {
    userId: user.id,
    sessionId,
    providerMessageId: sentMessage.providerMessageId,
    chatId: sentMessage.chatId,
    providerChatId: sentMessage.providerChatId,
    sendMode: sentMessage.mode,
    returnedMessage: sentMessage.returnedMessage,
  });

  const savedMessage = await WhatsAppMessage.build({
    userId: user.id,
    clientId: client.id,
    phone: normalizedPhone,
    message,
    providerMessageId: sentMessage.providerMessageId,
    status: "pending",
  }).save();

  trace("message.service.saved", {
    userId: user.id,
    sessionId,
    messageId: savedMessage.id,
    providerMessageId: savedMessage.providerMessageId,
    status: savedMessage.status,
  });

  return {
    phone: normalizedPhone,
    senderPhone: resolvedSenderPhone,
    messageId: savedMessage.id,
    providerMessageId: savedMessage.providerMessageId,
    status: savedMessage.status,
  };
};

module.exports = {
  normalizePhoneNumber,
  sendWhatsAppMessage,
};
