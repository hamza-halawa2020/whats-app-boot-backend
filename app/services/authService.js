const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const RefreshToken = require("../models/RefreshToken");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const { getPhoneLoginLookupValues } = require("../utils/phone");

const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "15m";
const REFRESH_TOKEN_EXPIRES_DAYS = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS || 30);

const getRefreshTokenExpiry = () => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_DAYS);
  return expiresAt;
};

const generateAccessToken = (user) =>
  jwt.sign({ _id: String(user.id) }, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });

const createRefreshToken = async (userId) => {
  const refreshToken = crypto.randomBytes(64).toString("hex");
  await RefreshToken.create({
    userId,
    tokenHash: RefreshToken.hashToken(refreshToken),
    expiresAt: getRefreshTokenExpiry(),
  });

  return refreshToken;
};

const issueAuthTokens = async (user) => ({
  token: generateAccessToken(user),
  refreshToken: await createRefreshToken(user.id),
});

const authenticateUser = async (identifier, password) => {
  const isEmailLogin = String(identifier || "").includes("@");
  const phoneLookupValues = isEmailLogin ? [] : getPhoneLoginLookupValues(identifier);
  const phoneDigits = isEmailLogin
    ? ""
    : String(identifier || "").trim().replace(/[^0-9]/g, "");
  const phoneConditions = phoneLookupValues.map((phone) => ({ phone }));

  if (!isEmailLogin && phoneDigits.length >= 8) {
    phoneConditions.push({ phone: { [Op.like]: `%${phoneDigits}` } });
    if (phoneDigits.startsWith("0") && phoneDigits.length > 8) {
      phoneConditions.push({ phone: { [Op.like]: `%${phoneDigits.slice(1)}` } });
    }
  }

  const user = await User.findOne({
    where: {
      [Op.or]: [
        { email: identifier },
        ...phoneConditions,
      ],
    },
  });
  if (!user) {
    throw new Error("Invalid login credentials");
  }

  const isPasswordMatch = await bcrypt.compare(password, user.password);
  if (!isPasswordMatch) {
    throw new Error("Invalid login credentials");
  }

  if (!user.isVerified) {
    const error = new Error("Account is not verified yet");
    error.statusCode = 403;
    throw error;
  }

  return user;
};

const verifyToken = async (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findByPk(decoded._id);

  if (!user) {
    throw new Error("User not found");
  }

  return user;
};

const rotateRefreshToken = async (refreshToken) => {
  const tokenHash = RefreshToken.hashToken(refreshToken);
  const storedToken = await RefreshToken.findOne({
    where: {
      tokenHash,
      revokedAt: null,
      expiresAt: { [Op.gt]: new Date() },
    },
    include: [{ model: User, as: "user" }],
  });

  if (!storedToken || !storedToken.user) {
    const error = new Error("Invalid refresh token");
    error.statusCode = 401;
    throw error;
  }

  if (!storedToken.user.isVerified) {
    const error = new Error("Account is not verified yet");
    error.statusCode = 403;
    throw error;
  }

  storedToken.revokedAt = new Date();
  await storedToken.save();

  return {
    user: storedToken.user,
    ...(await issueAuthTokens(storedToken.user)),
  };
};

const revokeRefreshToken = async (refreshToken) => {
  if (!refreshToken) {
    return;
  }

  await RefreshToken.update(
    { revokedAt: new Date() },
    {
      where: {
        tokenHash: RefreshToken.hashToken(refreshToken),
        revokedAt: null,
      },
    }
  );
};

module.exports = {
  authenticateUser,
  issueAuthTokens,
  rotateRefreshToken,
  revokeRefreshToken,
  verifyToken,
};
