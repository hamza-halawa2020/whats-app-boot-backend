const express = require("express");
const auth = require("../middlewares/auth");
const settingsController = require("../controllers/settingsController");

const router = express.Router();

router.get("/", auth, settingsController.getSettings);

module.exports = router;
