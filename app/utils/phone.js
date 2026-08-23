const normalizePhoneNumber = (phone) => {
  if (typeof phone !== "string") {
    const error = new Error("Phone must be a string");
    error.statusCode = 400;
    throw error;
  }

  const normalized = phone.trim().replace(/[^0-9]/g, "");

  if (!/^\d{10,15}$/.test(normalized)) {
    const error = new Error("Phone must include country code and contain 10 to 15 digits");
    error.statusCode = 400;
    throw error;
  }

  return normalized;
};

module.exports = {
  normalizePhoneNumber,
};
