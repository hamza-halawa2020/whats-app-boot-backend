const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePhoneNumber } = require("../app/utils/phone");

test("normalizes international phone numbers to digits only", () => {
  assert.equal(normalizePhoneNumber("+20 123 456 7890"), "201234567890");
});

test("normalizes local phone numbers with a country code", () => {
  assert.equal(normalizePhoneNumber("01149447078", "EG"), "201149447078");
});

test("rejects invalid phone numbers", () => {
  assert.throws(
    () => normalizePhoneNumber("123"),
    /Phone must include country code/
  );
});

test("rejects local numbers without country code", () => {
  assert.throws(
    () => normalizePhoneNumber("01149447078"),
    /Phone must include country code/
  );
});
