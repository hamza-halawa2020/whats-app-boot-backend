const ApiToken = require('../models/ApiToken');

module.exports = async (req, res, next) => {
  const token = req.header('X-API-Token');

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'API token is required',
    });
  }

  try {
    const apiToken = await ApiToken.findOne({ token }).populate('user');
    if (!apiToken) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API token',
      });
    }

    req.user = apiToken.user; // Attach user to request
    req.user.phone = apiToken.phone; // Attach phone to user
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Server error during token validation',
    });
  }
};