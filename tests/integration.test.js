const test = require("node:test");
const assert = require("node:assert/strict");

require("dotenv").config();

const { app } = require("../app");
const { sequelize } = require("../app/config/database");
const ensureSchemaUpdates = require("../app/config/schemaUpdates");
const ApiToken = require("../app/models/ApiToken");
const User = require("../app/models/User");

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
  await sequelize.sync();
  await ensureSchemaUpdates(sequelize);
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

  const me = await request(baseUrl, "/api/auth/me", {
    headers: authHeaders,
  });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.user.role, "user");
  assert.equal(me.body.user.walletPoints, 0);

  const wallet = await request(baseUrl, "/api/wallet", {
    headers: authHeaders,
  });
  assert.equal(wallet.response.status, 200);
  assert.equal(wallet.body.wallet.walletPoints, 0);

  const normalUserAdminList = await request(baseUrl, "/api/admin/users", {
    headers: authHeaders,
  });
  assert.equal(normalUserAdminList.response.status, 403);

  const sendWithoutPoints = await request(baseUrl, "/api/messages/messages", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      phone: "+20 111 777 8888",
      message: "Should not send without points",
    }),
  });
  assert.equal(sendWithoutPoints.response.status, 402);
  assert.equal(sendWithoutPoints.body.error, "Insufficient wallet points");

  const adminUser = await User.create({
    username: `admin${suffix}`.slice(0, 30),
    email: `admin-${suffix}@example.com`,
    password: "password123",
    phone: `20300${String(suffix).slice(-8)}`,
    role: "admin",
  });
  const adminToken = await adminUser.generateAuthToken();
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };

  const creditWallet = await request(baseUrl, `/api/admin/users/${signup.body.user.id}/wallet/credit`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ points: 5, note: "test credit" }),
  });
  assert.equal(creditWallet.response.status, 201);
  assert.equal(creditWallet.body.walletPoints, 5);

  const debitWallet = await request(baseUrl, `/api/admin/users/${signup.body.user.id}/wallet/debit`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ points: 2, note: "test debit" }),
  });
  assert.equal(debitWallet.response.status, 201);
  assert.equal(debitWallet.body.walletPoints, 3);

  const walletAfterAdminActions = await request(baseUrl, "/api/wallet", {
    headers: authHeaders,
  });
  assert.equal(walletAfterAdminActions.response.status, 200);
  assert.equal(walletAfterAdminActions.body.wallet.walletPoints, 3);
  assert.equal(walletAfterAdminActions.body.transactions.length, 2);

  const adminCreatedUser = await request(baseUrl, "/api/admin/users", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      username: `created${suffix}`.slice(0, 30),
      email: `created-${suffix}@example.com`,
      phone: `20400${String(suffix).slice(-8)}`,
      password: "password123",
      role: "user",
      walletPoints: 7,
    }),
  });
  assert.equal(adminCreatedUser.response.status, 201);
  assert.equal(adminCreatedUser.body.user.walletPoints, 7);
  assert.equal(adminCreatedUser.body.user.role, "user");
  assert.equal(Object.hasOwn(adminCreatedUser.body.user, "password"), false);

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
