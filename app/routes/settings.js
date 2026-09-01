const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const admin = require("../middlewares/admin");
const settingsController = require("../controllers/settingsController");

router.use(auth, admin);
router.get("/", settingsController.getSettings);
router.patch("/", settingsController.updateSettings);

module.exports = router;
