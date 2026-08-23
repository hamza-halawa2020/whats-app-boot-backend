const sendError = (res, error, fallbackStatus = 500) => {
  const statusCode = error.statusCode || fallbackStatus;

  return res.status(statusCode).json({
    success: false,
    error: statusCode >= 500 ? "Server error" : error.message,
  });
};

module.exports = {
  sendError,
};
