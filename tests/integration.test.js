const test = require("node:test");
const assert = require("node:assert/strict");

require("dotenv").config();
process.env.OTP_DELIVERY_MODE = "log";

const { app } = require("../app");
const { sequelize } = require("../app/config/database");
const ensureSchemaUpdates = require("../app/config/schemaUpdates");
const ApiToken = require("../app/models/ApiToken");
const SystemSetting = require("../app/models/SystemSetting");
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
  await SystemSetting.destroy({ truncate: true });
  const server = app.listen(0);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await sequelize.close();
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const suffix = Date.now();

  const signup = await request(baseUrl, "/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      name: `Tester ${suffix}`,
      password: "password123",
      countryCode: "EG",
      phone: `010${String(suffix).slice(-8)}`,
    }),
  });

  assert.equal(signup.response.status, 201);
  assert.equal(Object.hasOwn(signup.body, "token"), false);
  assert.equal(signup.body.user.isVerified, false);
  assert.match(signup.body.otpDebugCode, /^\d{6}$/);

  const login = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: signup.body.user.phone, password: "password123" }),
  });
  assert.equal(login.response.status, 403);

  const adminUser = await User.create({
    username: `admin${suffix}`.slice(0, 30),
    email: `admin-${suffix}@example.com`,
    password: "password123",
    phone: `+2012${String(suffix).slice(-8)}`,
    role: "admin",
    isVerified: true,
  });
  const adminToken = await adminUser.generateAuthToken();
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };

  const verifiedSignupUser = await request(baseUrl, "/api/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({
      phone: signup.body.user.phone,
      code: signup.body.otpDebugCode,
    }),
  });
  assert.equal(verifiedSignupUser.response.status, 200);
  assert.equal(verifiedSignupUser.body.user.isVerified, true);

  const verifiedSignupLogin = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: signup.body.user.phone, password: "password123" }),
  });
  assert.equal(verifiedSignupLogin.response.status, 200);
  assert.ok(verifiedSignupLogin.body.token);

  const token = verifiedSignupLogin.body.token;
  const authHeaders = { Authorization: `Bearer ${token}` };

  const phoneLogin = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      phone: signup.body.user.phone.replace(/^20/, "0"),
      password: "password123",
    }),
  });
  assert.equal(phoneLogin.response.status, 200);

  const profileUpdate = await request(baseUrl, "/api/auth/me", {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({
      username: `profile${String(suffix).slice(-8)}`.slice(0, 30),
      email: `profile-${suffix}@example.com`,
    }),
  });
  assert.equal(profileUpdate.response.status, 200);
  assert.equal(profileUpdate.body.user.email, `profile-${suffix}@example.com`);

  const forgotPassword = await request(baseUrl, "/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({
      phone: signup.body.user.phone.replace(/^20/, "0"),
      countryCode: "EG",
    }),
  });
  assert.equal(forgotPassword.response.status, 200);
  assert.match(forgotPassword.body.otpDebugCode, /^\d{6}$/);

  const resetPassword = await request(baseUrl, "/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({
      phone: signup.body.user.phone.replace(/^20/, "0"),
      countryCode: "EG",
      code: forgotPassword.body.otpDebugCode,
      password: "newpassword123",
    }),
  });
  assert.equal(resetPassword.response.status, 200);

  const oldPasswordLogin = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      phone: signup.body.user.phone,
      password: "password123",
    }),
  });
  assert.equal(oldPasswordLogin.response.status, 401);

  const newPasswordLogin = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      phone: signup.body.user.phone,
      password: "newpassword123",
    }),
  });
  assert.equal(newPasswordLogin.response.status, 200);
  authHeaders.Authorization = `Bearer ${newPasswordLogin.body.token}`;

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

  const defaultSettings = await request(baseUrl, "/api/admin/settings", {
    headers: adminHeaders,
  });
  assert.equal(defaultSettings.response.status, 200);
  assert.equal(defaultSettings.body.settings.messagePointCost, 1);

  const updatedSettings = await request(baseUrl, "/api/admin/settings", {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({
      signupGiftPoints: 4,
      messagePointCost: 2,
      dailyMessageLimit: 3,
      pointUnitPrice: 0.5,
      pointCurrency: "EGP",
    }),
  });
  assert.equal(updatedSettings.response.status, 200);
  assert.deepEqual(updatedSettings.body.settings, {
    signupGiftPoints: 4,
    messagePointCost: 2,
    dailyMessageLimit: 3,
    pointUnitPrice: 0.5,
    pointCurrency: "EGP",
  });

  const giftSignup = await request(baseUrl, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: `Gift User ${suffix}`,
      password: "password123",
      phone: `+2010${String(suffix + 2).slice(-8)}`,
    }),
  });
  assert.equal(giftSignup.response.status, 201);

  const verifiedGiftUser = await request(baseUrl, "/api/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({
      phone: `010${String(suffix + 2).slice(-8)}`,
      countryCode: "EG",
      code: giftSignup.body.otpDebugCode,
    }),
  });
  assert.equal(verifiedGiftUser.response.status, 200);
  assert.equal(verifiedGiftUser.body.user.walletPoints, 4);

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

  const createdPackage = await request(baseUrl, "/api/admin/payments/packages", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: `Starter ${suffix}`,
      points: 10,
      price: 1,
      currency: "EGP",
      isActive: true,
    }),
  });
  assert.equal(createdPackage.response.status, 201);
  assert.equal(createdPackage.body.package.points, 10);

  const pointPackages = await request(baseUrl, "/api/wallet/packages", {
    headers: authHeaders,
  });
  assert.equal(pointPackages.response.status, 200);
  assert.equal(
    pointPackages.body.packages.some((item) => item.id === createdPackage.body.package.id),
    true
  );

  const pointPurchase = await request(baseUrl, "/api/wallet/purchases", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      packageId: createdPackage.body.package.id,
      paymentMethod: "manual",
      proofReference: "receipt-1",
      proofFile: {
        name: "receipt.pdf",
        type: "application/pdf",
        data: Buffer.from("%PDF-1.4 test receipt").toString("base64"),
      },
      userNote: "paid manually",
    }),
  });
  assert.equal(pointPurchase.response.status, 201);
  assert.equal(pointPurchase.body.purchase.status, "pending");
  assert.equal(pointPurchase.body.purchase.points, 10);

  const refusedPurchase = await request(
    baseUrl,
    `/api/admin/payments/purchases/${pointPurchase.body.purchase.id}/review`,
    {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({
        status: "refused",
        adminNote: "Receipt number is missing",
      }),
    }
  );
  assert.equal(refusedPurchase.response.status, 200);
  assert.equal(refusedPurchase.body.purchase.status, "refused");

  const editedPurchase = await request(
    baseUrl,
    `/api/wallet/purchases/${pointPurchase.body.purchase.id}`,
    {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({
        proofReference: "receipt-1-fixed",
        proofFile: {
          name: "receipt-fixed.png",
          type: "image/png",
          data: Buffer.from("fake png receipt").toString("base64"),
        },
        userNote: "added receipt number",
      }),
    }
  );
  assert.equal(editedPurchase.response.status, 200);
  assert.equal(editedPurchase.body.purchase.status, "pending");

  const approvedPurchase = await request(
    baseUrl,
    `/api/admin/payments/purchases/${pointPurchase.body.purchase.id}/review`,
    {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({
        status: "approved",
        adminNote: "Receipt confirmed",
      }),
    }
  );
  assert.equal(approvedPurchase.response.status, 200);
  assert.equal(approvedPurchase.body.purchase.status, "approved");
  assert.ok(approvedPurchase.body.purchase.walletTransactionId);

  const walletAfterPurchase = await request(baseUrl, "/api/wallet", {
    headers: authHeaders,
  });
  assert.equal(walletAfterPurchase.response.status, 200);
  assert.equal(walletAfterPurchase.body.wallet.walletPoints, 13);

  const adminCreatedUser = await request(baseUrl, "/api/admin/users", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      username: `created${suffix}`.slice(0, 30),
      email: `created-${suffix}@example.com`,
      phone: `+2015${String(suffix).slice(-8)}`,
      password: "password123",
      role: "user",
      walletPoints: 7,
    }),
  });
  assert.equal(adminCreatedUser.response.status, 201);
  assert.equal(adminCreatedUser.body.user.walletPoints, 7);
  assert.equal(adminCreatedUser.body.user.role, "user");
  assert.equal(Object.hasOwn(adminCreatedUser.body.user, "password"), false);

  const unverifiedUser = await request(baseUrl, "/api/admin/users", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      username: `blocked${suffix}`.slice(0, 30),
      email: `blocked-${suffix}@example.com`,
      phone: `+2011${String(suffix).slice(-8)}`,
      password: "password123",
      role: "user",
      isVerified: false,
    }),
  });
  assert.equal(unverifiedUser.response.status, 201);
  assert.equal(unverifiedUser.body.user.isVerified, false);

  const blockedLogin = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: `blocked-${suffix}@example.com`,
      password: "password123",
    }),
  });
  assert.equal(blockedLogin.response.status, 403);

  const updatedUser = await request(baseUrl, `/api/admin/users/${unverifiedUser.body.user.id}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({
      username: `active${suffix}`.slice(0, 30),
      isVerified: true,
    }),
  });
  assert.equal(updatedUser.response.status, 200);
  assert.equal(updatedUser.body.user.isVerified, true);

  const adminAnalytics = await request(baseUrl, "/api/admin/users/analytics", {
    headers: adminHeaders,
  });
  assert.equal(adminAnalytics.response.status, 200);
  assert.ok(adminAnalytics.body.analytics.totalUsers >= 4);
  assert.ok(adminAnalytics.body.analytics.walletPoints >= 24);
  assert.ok(adminAnalytics.body.analytics.activePackages >= 1);
  assert.equal(typeof adminAnalytics.body.analytics.pendingPayments, "number");

  const verifiedLogin = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: `blocked-${suffix}@example.com`,
      password: "password123",
    }),
  });
  assert.equal(verifiedLogin.response.status, 200);

  const registerWithoutUsername = await request(baseUrl, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: `No Username ${suffix}`,
      password: "password123",
      phone: `+2010${String(suffix + 1).slice(-8)}`,
    }),
  });
  assert.equal(registerWithoutUsername.response.status, 201);
  assert.equal(Object.hasOwn(registerWithoutUsername.body, "token"), false);
  assert.equal(registerWithoutUsername.body.user.isVerified, false);
  assert.match(registerWithoutUsername.body.otpDebugCode, /^\d{6}$/);

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
