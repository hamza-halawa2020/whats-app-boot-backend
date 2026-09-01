const jwt = require("jsonwebtoken");
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const { getPhoneLoginLookupValues } = require("../utils/phone");

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

  if (!user || !(user.tokens || []).some((tokenObj) => tokenObj.token === token)) {
    throw new Error("User not found");
  }

  return user;
};

module.exports = {
  authenticateUser,
  verifyToken,
};
