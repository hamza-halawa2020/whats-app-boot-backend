const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const messageController = require("../controllers/messageController");

router.use(auth);
router.post("/messages", messageController.sendMessage);
router.post("/broadcast", messageController.sendRandomMessages);

module.exports = router;