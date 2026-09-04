const { sequelize } = require("../config/database");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const PointPackage = require("../models/PointPackage");
const PointPurchase = require("../models/PointPurchase");
const User = require("../models/User");
const { getAppSettings } = require("./settingsService");
const { createWalletTransaction } = require("./walletService");

const PAYMENT_METHODS = ["manual", "automatic"];
const REVIEW_STATUSES = ["approved", "refused", "canceled"];
const PROOF_UPLOAD_DIR = path.resolve(__dirname, "../../uploads/payment-proofs");
const ALLOWED_PROOF_TYPES = new Map([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);
const MAX_PROOF_FILE_BYTES = 5 * 1024 * 1024;

const parsePositiveInteger = (value, fieldName) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    const error = new Error(`${fieldName} must be a positive integer`);
    error.statusCode = 400;
    throw error;
  }

  return parsed;
};

const parsePositivePrice = (value, fieldName = "Price") => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const error = new Error(`${fieldName} must be greater than zero`);
    error.statusCode = 400;
    throw error;
  }

  return Number(parsed.toFixed(2));
};

const normalizeCurrency = (value) => {
  const currency = String(value || "EGP")
    .trim()
    .toUpperCase();

  if (!/^[A-Z]{3,10}$/.test(currency)) {
    const error = new Error("Currency must be 3 to 10 uppercase letters");
    error.statusCode = 400;
    throw error;
  }

  return currency;
};

const cleanText = (value, maxLength = 255) => {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
};

const saveProofFile = async (proofFile) => {
  if (!proofFile) {
    return {};
  }

  const mimeType = String(proofFile.type || "").trim().toLowerCase();
  const extension = ALLOWED_PROOF_TYPES.get(mimeType);
  if (!extension) {
    const error = new Error("Payment proof must be a PDF or image file");
    error.statusCode = 400;
    throw error;
  }

  const rawData = String(proofFile.data || "");
  const base64 = rawData.includes(",") ? rawData.split(",").pop() : rawData;
  const buffer = Buffer.from(base64, "base64");

  if (!buffer.length || buffer.length > MAX_PROOF_FILE_BYTES) {
    const error = new Error("Payment proof file must be between 1 byte and 5 MB");
    error.statusCode = 400;
    throw error;
  }

  await fs.mkdir(PROOF_UPLOAD_DIR, { recursive: true });

  const safeOriginalName = path.basename(String(proofFile.name || `payment-proof${extension}`));
  const storedName = `${Date.now()}-${crypto.randomUUID()}${extension}`;
  const fullPath = path.join(PROOF_UPLOAD_DIR, storedName);
  await fs.writeFile(fullPath, buffer);

  return {
    proofFileName: safeOriginalName.slice(0, 255),
    proofFileType: mimeType,
    proofFilePath: path.relative(path.resolve(__dirname, "../.."), fullPath),
  };
};

const deleteProofFile = async (proofFilePath) => {
  if (!proofFilePath) {
    return;
  }

  const appRoot = path.resolve(__dirname, "../..");
  const fullPath = path.resolve(appRoot, proofFilePath);
  const relativeToUploadDir = path.relative(PROOF_UPLOAD_DIR, fullPath);
  if (relativeToUploadDir.startsWith("..") || path.isAbsolute(relativeToUploadDir)) {
    return;
  }

  await fs.unlink(fullPath).catch(() => {});
};

const buildPurchaseInclude = () => [
  {
    model: User,
    as: "user",
    attributes: ["id", "username", "email", "phone", "walletPoints"],
  },
  {
    model: PointPackage,
    as: "package",
  },
  {
    model: User,
    as: "reviewer",
    attributes: ["id", "username", "email"],
  },
];

const listPackages = async ({ includeInactive = false, page = 1, limit = 10 } = {}) => {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const where = includeInactive ? {} : { isActive: true };
  const { rows, count } = await PointPackage.findAndCountAll({
    where,
    order: [["createdAt", "DESC"]],
    offset: (safePage - 1) * safeLimit,
    limit: safeLimit,
  });

  return {
    packages: rows,
    total: count,
    page: safePage,
    totalPages: Math.ceil(count / safeLimit),
  };
};

const createPackage = async ({ name, points, price, currency, isActive = true, adminId }) => {
  if (!cleanText(name, 80)) {
    const error = new Error("Package name is required");
    error.statusCode = 400;
    throw error;
  }

  return PointPackage.create({
    name: cleanText(name, 80),
    points: parsePositiveInteger(points, "Points"),
    price: parsePositivePrice(price),
    currency: normalizeCurrency(currency),
    isActive: Boolean(isActive),
    createdBy: adminId || null,
    updatedBy: adminId || null,
  });
};

const updatePackage = async (packageId, updates, adminId) => {
  const pointPackage = await PointPackage.findByPk(packageId);
  if (!pointPackage) {
    const error = new Error("Package not found");
    error.statusCode = 404;
    throw error;
  }

  if (updates.name !== undefined) {
    const name = cleanText(updates.name, 80);
    if (!name) {
      const error = new Error("Package name is required");
      error.statusCode = 400;
      throw error;
    }
    pointPackage.name = name;
  }

  if (updates.points !== undefined) {
    pointPackage.points = parsePositiveInteger(updates.points, "Points");
  }

  if (updates.price !== undefined) {
    pointPackage.price = parsePositivePrice(updates.price);
  }

  if (updates.currency !== undefined) {
    pointPackage.currency = normalizeCurrency(updates.currency);
  }

  if (updates.isActive !== undefined) {
    pointPackage.isActive = Boolean(updates.isActive);
  }

  pointPackage.updatedBy = adminId || null;
  await pointPackage.save();
  return pointPackage;
};

const createPurchase = async ({
  userId,
  packageId = null,
  paymentMethod,
  points,
  proofReference,
  userNote,
  proofFile,
}) => {
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    const error = new Error("Payment method must be manual or automatic");
    error.statusCode = 400;
    throw error;
  }

  let selectedPackage = null;
  let purchasePoints = null;
  let amount = null;
  let currency = null;

  if (packageId) {
    selectedPackage = await PointPackage.findOne({
      where: { id: packageId, isActive: true },
    });

    if (!selectedPackage) {
      const error = new Error("Package not found or inactive");
      error.statusCode = 404;
      throw error;
    }

    purchasePoints = selectedPackage.points;
    amount = Number(selectedPackage.price);
    currency = selectedPackage.currency;
  } else {
    const settings = await getAppSettings();
    purchasePoints = parsePositiveInteger(points, "Points");
    amount = Number((purchasePoints * settings.pointUnitPrice).toFixed(2));
    currency = settings.pointCurrency;
  }

  if (paymentMethod === "manual" && !proofFile) {
    const error = new Error("Payment proof file is required for manual payments");
    error.statusCode = 400;
    throw error;
  }

  const proofFileData = await saveProofFile(proofFile);

  return PointPurchase.create({
    userId,
    packageId: selectedPackage?.id || null,
    paymentMethod,
    points: purchasePoints,
    amount,
    currency,
    proofReference: cleanText(proofReference),
    ...proofFileData,
    userNote: cleanText(userNote, 1000),
  });
};

const listUserPurchases = async ({ userId, page = 1, limit = 10 }) => {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

  const { rows, count } = await PointPurchase.findAndCountAll({
    where: { userId },
    include: buildPurchaseInclude().filter((item) => item.as !== "user"),
    order: [["createdAt", "DESC"]],
    offset: (safePage - 1) * safeLimit,
    limit: safeLimit,
  });

  return {
    purchases: rows,
    total: count,
    page: safePage,
    totalPages: Math.ceil(count / safeLimit),
  };
};

const listAdminPurchases = async ({ status, page = 1, limit = 10 }) => {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const where = status ? { status } : {};

  const { rows, count } = await PointPurchase.findAndCountAll({
    where,
    include: buildPurchaseInclude(),
    order: [["createdAt", "DESC"]],
    offset: (safePage - 1) * safeLimit,
    limit: safeLimit,
  });

  return {
    purchases: rows,
    total: count,
    page: safePage,
    totalPages: Math.ceil(count / safeLimit),
  };
};

const updateRefusedPurchase = async ({ userId, purchaseId, proofReference, userNote, proofFile }) => {
  const purchase = await PointPurchase.findOne({
    where: { id: purchaseId, userId },
  });

  if (!purchase) {
    const error = new Error("Payment request not found");
    error.statusCode = 404;
    throw error;
  }

  if (purchase.status !== "refused") {
    const error = new Error("Only refused payment requests can be edited");
    error.statusCode = 400;
    throw error;
  }

  const proofFileData = proofFile ? await saveProofFile(proofFile) : {};
  if (proofFileData.proofFilePath) {
    await deleteProofFile(purchase.proofFilePath);
  }

  purchase.proofReference = cleanText(proofReference);
  Object.assign(purchase, proofFileData);
  purchase.userNote = cleanText(userNote, 1000);
  purchase.status = "pending";
  purchase.adminNote = null;
  purchase.reviewedBy = null;
  purchase.reviewedAt = null;
  await purchase.save();
  return purchase.reload({ include: buildPurchaseInclude().filter((item) => item.as !== "user") });
};

const getPurchaseProof = async ({ purchaseId, requester }) => {
  const purchase = await PointPurchase.findByPk(purchaseId);

  if (!purchase) {
    const error = new Error("Payment request not found");
    error.statusCode = 404;
    throw error;
  }

  const isOwner = Number(purchase.userId) === Number(requester.id);
  const isAdmin = requester.role === "admin";
  if (!isOwner && !isAdmin) {
    const error = new Error("You cannot access this payment proof");
    error.statusCode = 403;
    throw error;
  }

  if (!purchase.proofFilePath) {
    const error = new Error("Payment proof file not found");
    error.statusCode = 404;
    throw error;
  }

  const appRoot = path.resolve(__dirname, "../..");
  const fullPath = path.resolve(appRoot, purchase.proofFilePath);
  const relativeToUploadDir = path.relative(PROOF_UPLOAD_DIR, fullPath);
  if (relativeToUploadDir.startsWith("..") || path.isAbsolute(relativeToUploadDir)) {
    const error = new Error("Payment proof file path is invalid");
    error.statusCode = 400;
    throw error;
  }

  await fs.access(fullPath);

  return {
    path: fullPath,
    fileName: purchase.proofFileName || path.basename(fullPath),
    mimeType: purchase.proofFileType || "application/octet-stream",
  };
};

const reviewPurchase = async ({ purchaseId, status, adminNote, adminId }) => {
  if (!REVIEW_STATUSES.includes(status)) {
    const error = new Error("Status must be approved, refused, or canceled");
    error.statusCode = 400;
    throw error;
  }

  if (status === "refused" && !cleanText(adminNote, 1000)) {
    const error = new Error("Admin note is required when refusing a payment");
    error.statusCode = 400;
    throw error;
  }

  return sequelize.transaction(async (transaction) => {
    const purchase = await PointPurchase.findByPk(purchaseId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!purchase) {
      const error = new Error("Payment request not found");
      error.statusCode = 404;
      throw error;
    }

    if (purchase.status !== "pending") {
      const error = new Error("Only pending payment requests can be reviewed");
      error.statusCode = 400;
      throw error;
    }

    let walletTransactionId = null;
    if (status === "approved") {
      const walletTransaction = await createWalletTransaction({
        userId: purchase.userId,
        type: "credit",
        source: "payment",
        points: purchase.points,
        adminId,
        note: cleanText(adminNote) || `Payment request #${purchase.id}`,
        transaction,
      });
      walletTransactionId = walletTransaction.id;
    }

    purchase.status = status;
    purchase.adminNote = cleanText(adminNote, 1000);
    purchase.reviewedBy = adminId;
    purchase.reviewedAt = new Date();
    purchase.walletTransactionId = walletTransactionId;
    await purchase.save({ transaction });

    return purchase;
  });
};

module.exports = {
  listPackages,
  createPackage,
  updatePackage,
  createPurchase,
  listUserPurchases,
  listAdminPurchases,
  updateRefusedPurchase,
  reviewPurchase,
  getPurchaseProof,
};
