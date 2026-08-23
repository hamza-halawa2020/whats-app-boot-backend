const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const messageController = require("../controllers/messageController");

router.use(auth);
router.post("/messages", messageController.sendMessage);
router.get("/history", messageController.getMessageHistory);
router.post("/broadcast", messageController.sendRandomMessages);
router.get("/schedules", messageController.getSchedules);
router.post("/schedules/toggle", messageController.toggleSchedule);
router.post("/toggle-schedule", messageController.toggleSchedule);
router.get("/templates", messageController.getTemplates);
router.post("/templates", messageController.createTemplate);
router.put("/templates/:id", messageController.updateTemplate);
router.delete("/templates/:id", messageController.deleteTemplate);

module.exports = router;
