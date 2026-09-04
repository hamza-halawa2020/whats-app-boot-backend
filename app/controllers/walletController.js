const { getWalletSummary, getWalletTransactions } = require("../services/walletService");
const { getDailyMessageUsage } = require("../services/messageService");
const {
  createPurchase,
  listPackages,
  listUserPurchases,
  getPurchaseProof,
  updateRefusedPurchase,
} = require("../services/pointPurchaseService");
const { sendError } = require("../utils/responses");

exports.getWallet = async (req, res) => {
  try {
    const summary = await getWalletSummary(req.user.id);
    const history = await getWalletTransactions({
      userId: req.user.id,
      page: 1,
      limit: 10,
    });

    return res.json({
      success: true,
      wallet: summary,
      transactions: history.transactions,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const history = await getWalletTransactions({
      userId: req.user.id,
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

exports.getExternalWallet = async (req, res) => {
  try {
    const [summary, dailyUsage] = await Promise.all([
      getWalletSummary(req.user.id),
      getDailyMessageUsage(req.user.id),
    ]);

    return res.json({
      success: true,
      wallet: summary,
      walletPoints: summary.walletPoints,
      remainingPoints: summary.walletPoints,
      dailyLimit: dailyUsage.dailyLimit,
      sentToday: dailyUsage.sentToday,
      remainingDailyLimit: dailyUsage.remainingDailyLimit,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getPointPackages = async (req, res) => {
  try {
    const result = await listPackages({
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

exports.createPointPurchase = async (req, res) => {
  try {
    const purchase = await createPurchase({
      userId: req.user.id,
      packageId: req.body.packageId,
      paymentMethod: req.body.paymentMethod,
      points: req.body.points,
      proofReference: req.body.proofReference,
      proofFile: req.body.proofFile,
      userNote: req.body.userNote,
    });

    return res.status(201).json({
      success: true,
      message:
        purchase.paymentMethod === "automatic"
          ? "Payment request created. Gateway integration is not enabled yet."
          : "Manual payment request submitted for admin review",
      purchase,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getPointPurchases = async (req, res) => {
  try {
    const history = await listUserPurchases({
      userId: req.user.id,
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

exports.updatePointPurchase = async (req, res) => {
  try {
    const purchase = await updateRefusedPurchase({
      userId: req.user.id,
      purchaseId: req.params.id,
      proofReference: req.body.proofReference,
      proofFile: req.body.proofFile,
      userNote: req.body.userNote,
    });

    return res.json({
      success: true,
      message: "Payment request updated and sent back for review",
      purchase,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getPointPurchaseProof = async (req, res) => {
  try {
    const proof = await getPurchaseProof({
      purchaseId: req.params.id,
      requester: req.user,
    });

    res.setHeader("Content-Type", proof.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${proof.fileName.replace(/"/g, "")}"`);
    return res.sendFile(proof.path);
  } catch (error) {
    return sendError(res, error);
  }
};
