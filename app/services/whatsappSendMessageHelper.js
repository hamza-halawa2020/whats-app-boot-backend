const createHasSendMessageHelper = ({
  isWhatsAppClientUsable,
  isPuppeteerTargetClosedError,
}) => {
  const hasSendMessageHelper = async (client) => {
    if (!isWhatsAppClientUsable(client)) {
      return false;
    }

    try {
      return await client.pupPage?.evaluate(
        () => typeof window.WWebJS?.sendMessage === "function"
      );
    } catch (error) {
      if (isPuppeteerTargetClosedError(error)) {
        return false;
      }
      return false;
    }
  };

  return hasSendMessageHelper;
};

module.exports = {
  createHasSendMessageHelper,
};

