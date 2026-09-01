const { sequelize } = require("../config/database");
const User = require("../models/User");
const WalletTransaction = require("../models/WalletTransaction");
const { getAppSettings } = require("./settingsService");

const DEFAULT_MESSAGE_POINT_COST = Number(process.env.MESSAGE_POINT_COST || 1);

const parsePoints = (points) => {
  const parsed = Number(points);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    const error = new Error("Points must be a positive integer");
    error.statusCode = 400;
    throw error;
  }

  return parsed;
};

const findLockedUser = async (userId, transaction) => {
  const user = await User.findByPk(userId, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  return user;
};

const createWalletTransaction = async ({
  userId,
  type,
  source,
  points,
  adminId = null,
  messageId = null,
  note = null,
  transaction,
}) => {
  const user = await findLockedUser(userId, transaction);
  const balanceBefore = Number(user.walletPoints || 0);

  let balanceAfter = balanceBefore;
  if (["credit", "refund"].includes(type)) {
    balanceAfter += points;
  } else if (["debit", "adjustment"].includes(type)) {
    if (balanceBefore < points) {
      const error = new Error("Insufficient wallet points");
      error.statusCode = 402;
      throw error;
    }
    balanceAfter -= points;
  } else {
    const error = new Error("Invalid wallet transaction type");
    error.statusCode = 400;
    throw error;
  }

  user.walletPoints = balanceAfter;
  await user.save({ transaction });

  return WalletTransaction.create(
    {
      userId,
      type,
      source,
      points,
      balanceBefore,
      balanceAfter,
      adminId,
      messageId,
      note,
    },
    { transaction }
  );
};

const creditPoints = async ({ userId, points, adminId = null, source = "admin", note = null }) =>
  sequelize.transaction(async (transaction) =>
    createWalletTransaction({
      userId,
      type: "credit",
      source,
      points: parsePoints(points),
      adminId,
      note,
      transaction,
    })
  );

const debitPoints = async ({
  userId,
  points,
  source = "message",
  messageId = null,
  adminId = null,
  note = null,
}) =>
  sequelize.transaction(async (transaction) =>
    createWalletTransaction({
      userId,
      type: "debit",
      source,
      points: parsePoints(points),
      messageId,
      adminId,
      note,
      transaction,
    })
  );

const refundPoints = async ({ userId, points, source = "system", messageId = null, note = null }) =>
  sequelize.transaction(async (transaction) =>
    createWalletTransaction({
      userId,
      type: "refund",
      source,
      points: parsePoints(points),
      messageId,
      note,
      transaction,
    })
  );

const updateTransactionMessage = async ({ transactionId, messageId }) => {
  if (!transactionId || !messageId) {
    return null;
  }

  const transaction = await WalletTransaction.findByPk(transactionId);
  if (!transaction) {
    return null;
  }

  transaction.messageId = messageId;
  await transaction.save();
  return transaction;
};

const getWalletSummary = async (userId) => {
  const user = await User.findByPk(userId, {
    attributes: ["id", "walletPoints"],
  });

  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  return {
    userId: user.id,
    walletPoints: Number(user.walletPoints || 0),
  };
};

const getWalletTransactions = async ({ userId, page = 1, limit = 20 }) => {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

  const { rows, count } = await WalletTransaction.findAndCountAll({
    where: { userId },
    order: [["createdAt", "DESC"]],
    offset: (safePage - 1) * safeLimit,
    limit: safeLimit,
  });

  return {
    transactions: rows,
    total: count,
    page: safePage,
    totalPages: Math.ceil(count / safeLimit),
  };
};

module.exports = {
  DEFAULT_MESSAGE_POINT_COST,
  getMessagePointCost: async () => {
    const settings = await getAppSettings();
    return settings.messagePointCost;
  },
  creditPoints,
  debitPoints,
  refundPoints,
  updateTransactionMessage,
  getWalletSummary,
  getWalletTransactions,
};
