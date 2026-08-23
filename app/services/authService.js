const jwt = require("jsonwebtoken");
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");

const authenticateUser = async (identifier, password) => {
  const user = await User.findOne({
    where: {
      [Op.or]: [{ email: identifier }, { phone: identifier }],
    },
  });
  if (!user) {
    throw new Error("Invalid login credentials");
  }

  const isPasswordMatch = await bcrypt.compare(password, user.password);
  if (!isPasswordMatch) {
    throw new Error("Invalid login credentials");
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
