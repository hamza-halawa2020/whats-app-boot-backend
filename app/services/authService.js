const jwt = require("jsonwebtoken");
const User = require("../models/User");
const bcrypt = require("bcryptjs");

const authenticateUser = async (email, password) => {
  const user = await User.findOne({ email });
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
  const user = await User.findOne({ _id: decoded._id, "tokens.token": token });

  if (!user) {
    throw new Error("User not found");
  }

  return user;
};

module.exports = {
  authenticateUser,
  verifyToken,
};
