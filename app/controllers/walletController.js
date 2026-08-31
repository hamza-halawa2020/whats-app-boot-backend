const { getWalletSummary, getWalletTransactions } = require("../services/walletService");
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
