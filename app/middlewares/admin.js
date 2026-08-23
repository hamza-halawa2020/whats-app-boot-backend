module.exports = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({
      success: false,
      error: "Admin access is required",
    });
  }

  next();
};
