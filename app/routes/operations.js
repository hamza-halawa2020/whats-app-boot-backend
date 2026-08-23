const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const admin = require("../middlewares/admin");
const operationsController = require("../controllers/operationsController");

router.get("/health", operationsController.health);
router.get("/usage", auth, operationsController.usage);
router.get("/rate-limits", auth, operationsController.rateLimits);
router.get("/admin/dashboard", auth, admin, operationsController.dashboard);
router.get("/admin/audit-logs", auth, admin, operationsController.auditLogs);
router.get("/admin/sessions", auth, admin, operationsController.adminSessions);
router.post(
  "/admin/sessions/:id/disconnect",
  auth,
  admin,
  operationsController.adminDisconnectSession
);

module.exports = router;
