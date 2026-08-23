const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DB_NAME = process.env.DB_NAME || "test";
process.env.DB_USER = process.env.DB_USER || "test";

const ApiToken = require("../app/models/ApiToken");

test("hashToken returns a stable sha256 hash", () => {
  const token = "sample-token";
  assert.equal(ApiToken.hashToken(token), ApiToken.hashToken(token));
  assert.equal(ApiToken.hashToken(token).length, 64);
  assert.notEqual(ApiToken.hashToken(token), token);
});

test("generateRawToken returns a non-empty token", () => {
  assert.equal(typeof ApiToken.generateRawToken(), "string");
  assert.ok(ApiToken.generateRawToken().length > 10);
});
