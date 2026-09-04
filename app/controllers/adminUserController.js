const User = require("../models/User");
const PointPackage = require("../models/PointPackage");
const PointPurchase = require("../models/PointPurchase");
const { creditPoints, debitPoints, getWalletTransactions } = require("../services/walletService");
const { sendError } = require("../utils/responses");
const { normalizePhoneNumber } = require("../utils/phone");

const buildPublicUser = (user) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  phone: user.phone,
  role: user.role,
  walletPoints: user.walletPoints,
  isVerified: user.isVerified,
  createdAt: user.createdAt,
});

exports.getAnalytics = async (req, res) => {
  try {
    const [totalUsers, verifiedUsers, adminUsers, pendingPayments, activePackages, walletPoints] =
      await Promise.all([
        User.count(),
        User.count({ where: { isVerified: true } }),
        User.count({ where: { role: "admin" } }),
        PointPurchase.count({ where: { status: "pending" } }),
        PointPackage.count({ where: { isActive: true } }),
        User.sum("walletPoints"),
      ]);

    return res.json({
      success: true,
      analytics: {
        totalUsers,
        verifiedUsers,
        adminUsers,
        pendingPayments,
        activePackages,
        walletPoints: Number(walletPoints || 0),
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.listUsers = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const { rows, count } = await User.findAndCountAll({
      attributes: [
        "id",
        "username",
        "email",
        "phone",
        "role",
        "walletPoints",
        "isVerified",
        "createdAt",
      ],
      order: [["createdAt", "DESC"]],
      offset: (page - 1) * limit,
      limit,
    });

    return res.json({
      success: true,
      users: rows.map(buildPublicUser),
      total: count,
      page,
      totalPages: Math.ceil(count / limit),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.createUser = async (req, res) => {
  try {
    const {
      username,
      email,
      phone,
      password,
      role = "user",
      walletPoints = 0,
      isVerified = true,
    } = req.body;

    if (!username || !phone || !password) {
      return res.status(400).json({
        success: false,
        error: "Username, phone, and password are required",
      });
    }

    if (!["admin", "user"].includes(role)) {
      return res.status(400).json({
        success: false,
        error: "Role must be admin or user",
      });
    }

    const initialPoints = Number(walletPoints || 0);
    if (!Number.isInteger(initialPoints) || initialPoints < 0) {
      return res.status(400).json({
        success: false,
        error: "Wallet points must be zero or a positive integer",
      });
    }

    const user = await User.create({
      username,
      email: email ? email.trim().toLowerCase() : null,
      phone: normalizePhoneNumber(phone),
      password,
      role,
      isVerified: Boolean(isVerified),
    });

    let walletTransaction = null;
    if (initialPoints > 0) {
      walletTransaction = await creditPoints({
        userId: user.id,
        points: initialPoints,
        adminId: req.user.id,
        note: "Initial wallet points",
      });
    }

    const freshUser = await User.findByPk(user.id);

    return res.status(201).json({
      success: true,
      message: "User created successfully",
      user: buildPublicUser(freshUser),
      walletTransaction,
    });
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      error.message = "Username, email, or phone already exists";
      error.statusCode = 400;
    } else if (error.name === "SequelizeValidationError") {
      error.message = error.errors?.[0]?.message || "Invalid user data";
      error.statusCode = 400;
    }

    return sendError(res, error);
  }
};

exports.updateUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const allowedFields = ["username", "email", "phone", "password", "role", "isVerified"];
    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined && req.body[field] !== "") {
        updates[field] = req.body[field];
      }
    }

    if (updates.role && !["admin", "user"].includes(updates.role)) {
      return res.status(400).json({
        success: false,
        error: "Role must be admin or user",
      });
    }

    if (user.role === "admin" && updates.role === "user") {
      const adminCount = await User.count({ where: { role: "admin" } });
      if (adminCount <= 1) {
        return res.status(400).json({
          success: false,
          error: "Cannot remove the last admin",
        });
      }
    }

    if (updates.isVerified !== undefined) {
      updates.isVerified = Boolean(updates.isVerified);
    }

    if (updates.email !== undefined) {
      updates.email = updates.email ? updates.email.trim().toLowerCase() : null;
    }

    if (updates.phone !== undefined) {
      updates.phone = normalizePhoneNumber(updates.phone);
    }

    Object.assign(user, updates);
    await user.save();

    return res.json({
      success: true,
      message: "User updated successfully",
      user: buildPublicUser(user),
    });
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      error.message = "Username, email, or phone already exists";
      error.statusCode = 400;
    } else if (error.name === "SequelizeValidationError") {
      error.message = error.errors?.[0]?.message || "Invalid user data";
      error.statusCode = 400;
    }

    return sendError(res, error);
  }
};

exports.creditUserWallet = async (req, res) => {
  try {
    const transaction = await creditPoints({
      userId: req.params.id,
      points: req.body.points,
      adminId: req.user.id,
      note: req.body.note || null,
    });

    return res.status(201).json({
      success: true,
      message: "Points added successfully",
      transaction,
      walletPoints: transaction.balanceAfter,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.debitUserWallet = async (req, res) => {
  try {
    const transaction = await debitPoints({
      userId: req.params.id,
      points: req.body.points,
      source: "admin",
      adminId: req.user.id,
      note: req.body.note || null,
    });

    return res.status(201).json({
      success: true,
      message: "Points deducted successfully",
      transaction,
      walletPoints: transaction.balanceAfter,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.updateUserRole = async (req, res) => {
  try {
    const { role } = req.body;
    if (!["admin", "user"].includes(role)) {
      return res.status(400).json({
        success: false,
        error: "Role must be admin or user",
      });
    }

    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    if (user.role === "admin" && role === "user") {
      const adminCount = await User.count({ where: { role: "admin" } });
      if (adminCount <= 1) {
        return res.status(400).json({
          success: false,
          error: "Cannot remove the last admin",
        });
      }
    }

    user.role = role;
    await user.save();

    return res.json({
      success: true,
      message: "User role updated successfully",
      user: buildPublicUser(user),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getUserWalletTransactions = async (req, res) => {
  try {
    const history = await getWalletTransactions({
      userId: req.params.id,
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
