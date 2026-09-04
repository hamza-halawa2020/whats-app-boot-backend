const {
  createPackage,
  listAdminPurchases,
  listPackages,
  reviewPurchase,
  updatePackage,
} = require("../services/pointPurchaseService");
const { sendError } = require("../utils/responses");

exports.listPackages = async (req, res) => {
  try {
    const result = await listPackages({
      includeInactive: true,
      page: req.query.page,
      limit: req.query.limit,
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.createPackage = async (req, res) => {
  try {
    const pointPackage = await createPackage({
      ...req.body,
      adminId: req.user.id,
    });

    return res.status(201).json({
      success: true,
      message: "Point package created successfully",
      package: pointPackage,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.updatePackage = async (req, res) => {
  try {
    const pointPackage = await updatePackage(req.params.id, req.body, req.user.id);

    return res.json({
      success: true,
      message: "Point package updated successfully",
      package: pointPackage,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.listPurchases = async (req, res) => {
  try {
    const history = await listAdminPurchases({
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
    });

    return res.json({
      success: true,
      ...history,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.reviewPurchase = async (req, res) => {
  try {
    const purchase = await reviewPurchase({
      purchaseId: req.params.id,
      status: req.body.status,
      adminNote: req.body.adminNote,
      adminId: req.user.id,
    });

    return res.json({
      success: true,
      message: `Payment request ${purchase.status}`,
      purchase,
    });
  } catch (error) {
    return sendError(res, error);
  }
};
