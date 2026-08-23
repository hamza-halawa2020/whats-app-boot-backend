const test = require("node:test");
const assert = require("node:assert/strict");

require("dotenv").config();

const { app } = require("../app");
const { sequelize } = require("../app/config/database");
const ApiToken = require("../app/models/ApiToken");

const request = async (baseUrl, path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  return { response, body };
};

test("core API integration flow", async (t) => {
  await sequelize.sync({ alter: true });
  const server = app.listen(0);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await sequelize.close();
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const suffix = Date.now();
  const email = `integration-${suffix}@example.com`;

  const signup = await request(baseUrl, "/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      username: `tester${suffix}`,
      email,
      password: "password123",
      phone: `20100${String(suffix).slice(-8)}`,
    }),
  });

  assert.equal(signup.response.status, 201);
  assert.ok(signup.body.token);

  const token = signup.body.token;
  const authHeaders = { Authorization: `Bearer ${token}` };

  const login = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "password123" }),
  });
  assert.equal(login.response.status, 200);

  const phoneLogin = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: signup.body.user.phone, password: "password123" }),
  });
  assert.equal(phoneLogin.response.status, 200);

  const registerWithoutUsername = await request(baseUrl, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: `No Username ${suffix}`,
      email: `nousername-${suffix}@example.com`,
      password: "password123",
      phone: `20200${String(suffix).slice(-8)}`,
    }),
  });
  assert.equal(registerWithoutUsername.response.status, 201);

  const addClient = await request(baseUrl, "/api/clients", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      phone: "+20 111 222 3333",
      name: "Client One",
      tags: ["lead"],
      segment: "sales",
    }),
  });
  assert.equal(addClient.response.status, 201);
  assert.equal(addClient.body.client.phone, "201112223333");

  const preview = await request(baseUrl, "/api/clients/import/preview", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      rows: [{ phone: "+20 111 222 3333" }, { phone: "+20 122 222 3333" }],
    }),
  });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.preview.validCount, 2);
  assert.equal(preview.body.preview.duplicateCount, 1);

  const template = await request(baseUrl, "/api/messages/templates", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      name: `welcome-${suffix}`,
      body: "Hello {{name}}",
      variables: ["name"],
    }),
  });
  assert.equal(template.response.status, 201);

  const schedules = await request(baseUrl, "/api/messages/schedules", {
    headers: authHeaders,
  });
  assert.equal(schedules.response.status, 200);
  assert.ok(Array.isArray(schedules.body.schedules));

  const userId = signup.body.user.id;
  const rawApiToken = ApiToken.generateRawToken();
  const apiToken = await ApiToken.create({
    userId,
    phone: signup.body.user.phone,
    token: ApiToken.hashToken(rawApiToken),
    name: "integration",
    scopes: ["messages:send"],
  });

  const tokens = await request(baseUrl, "/api/tokens", {
    headers: authHeaders,
  });
  assert.equal(tokens.response.status, 200);
  assert.equal(tokens.body.tokens.some((item) => item.id === apiToken.id), true);
  assert.equal(Object.hasOwn(tokens.body.tokens[0], "token"), false);

  const rotate = await request(baseUrl, `/api/tokens/${apiToken.id}/rotate`, {
    method: "POST",
    headers: authHeaders,
  });
  assert.equal(rotate.response.status, 200);
  assert.ok(rotate.body.token);

  const revoke = await request(baseUrl, "/api/tokens/revoke", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ tokenId: apiToken.id }),
  });
  assert.equal(revoke.response.status, 200);

  const health = await request(baseUrl, "/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.database, "ok");
});
