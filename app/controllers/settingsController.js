const { getAppSettings, updateAppSettings } = require("../services/settingsService");
const { sendError } = require("../utils/responses");

exports.getSettings = async (req, res) => {
  try {
    const settings = await getAppSettings();
    return res.json({
      success: true,
      settings,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const allowedFields = ["signupGiftPoints", "messagePointCost", "dailyMessageLimit"];
    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        const value = Number(req.body[field]);
        if (!Number.isInteger(value) || value < 0 || (field === "messagePointCost" && value < 1)) {
          return res.status(400).json({
            success: false,
            error:
              field === "messagePointCost"
                ? "Message point cost must be a positive integer"
                : "Settings values must be zero or positive integers",
          });
        }
        updates[field] = value;
      }
    }

    const settings = await updateAppSettings(updates, req.user.id);
    return res.json({
      success: true,
      message: "Settings updated successfully",
      settings,
    });
  } catch (error) {
    return sendError(res, error);
  }
};
