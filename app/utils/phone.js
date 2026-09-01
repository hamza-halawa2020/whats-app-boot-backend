const { PhoneNumberUtil, PhoneNumberFormat } = require("google-libphonenumber");

const phoneUtil = PhoneNumberUtil.getInstance();

const normalizeCountryCode = (countryCode) =>
  String(countryCode || "").trim().replace(/[^A-Z]/gi, "").toUpperCase();

const normalizePhoneNumber = (phone, countryCode = null) => {
  if (typeof phone !== "string") {
    const error = new Error("Phone must be a string");
    error.statusCode = 400;
    throw error;
  }

  const rawPhone = phone.trim();
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  if (!rawPhone.startsWith("+") && !normalizedCountryCode) {
    const error = new Error("Phone must include country code, for example +201001234567");
    error.statusCode = 400;
    throw error;
  }

  let parsedPhone;
  try {
    parsedPhone = phoneUtil.parseAndKeepRawInput(
      rawPhone,
      normalizedCountryCode || undefined
    );
  } catch (parseError) {
    const error = new Error("Phone number is invalid");
    error.statusCode = 400;
    throw error;
  }

  if (!phoneUtil.isValidNumber(parsedPhone)) {
    const error = new Error("Phone number is invalid");
    error.statusCode = 400;
    throw error;
  }

  return phoneUtil
    .format(parsedPhone, PhoneNumberFormat.E164)
    .replace(/[^0-9]/g, "");
};

const getPhoneLoginLookupValues = (phone) => {
  if (typeof phone !== "string") {
    return [];
  }

  const digits = phone.trim().replace(/[^0-9]/g, "");
  const values = new Set();

  if (digits) {
    values.add(digits);
  }

  try {
    values.add(normalizePhoneNumber(phone));
  } catch (error) {
    // Local login fallback is handled by suffix matching in authService.
  }

  return [...values];
};

module.exports = {
  normalizePhoneNumber,
  normalizeCountryCode,
  getPhoneLoginLookupValues,
};
