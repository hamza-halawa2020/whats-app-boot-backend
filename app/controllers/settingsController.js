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
    const integerFields = ["signupGiftPoints", "messagePointCost", "dailyMessageLimit"];
    const updates = {};

    for (const field of integerFields) {
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

    if (req.body.pointUnitPrice !== undefined) {
      const value = Number(req.body.pointUnitPrice);
      if (!Number.isFinite(value) || value <= 0) {
        return res.status(400).json({
          success: false,
          error: "Point unit price must be greater than zero",
        });
      }
      updates.pointUnitPrice = value;
    }

    if (req.body.pointCurrency !== undefined) {
      const currency = String(req.body.pointCurrency || "")
        .trim()
        .toUpperCase();

      if (!/^[A-Z]{3,10}$/.test(currency)) {
        return res.status(400).json({
          success: false,
          error: "Point currency must be 3 to 10 letters",
        });
      }

      updates.pointCurrency = currency;
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
