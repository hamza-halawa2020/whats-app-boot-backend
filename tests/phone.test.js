const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePhoneNumber } = require("../app/utils/phone");

test("normalizes phone numbers to digits only", () => {
  assert.equal(normalizePhoneNumber("+20 123 456 7890"), "201234567890");
});

test("rejects invalid phone numbers", () => {
  assert.throws(
    () => normalizePhoneNumber("123"),
    /Phone must include country code/
  );
});
