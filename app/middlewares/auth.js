const { verifyToken } = require('../services/authService');

const auth = async (req, res, next) => {
  try {
    const authorization = req.header("Authorization");
    if (!authorization || !authorization.startsWith("Bearer ")) {
      throw new Error("Missing authorization header");
    }

    const token = authorization.replace("Bearer ", "");
    const user = await verifyToken(token);
    
    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Please authenticate' });
  }
};

module.exports = auth;
