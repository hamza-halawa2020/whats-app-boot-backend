const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const whatsappController = require("../controllers/whatsappController");

router.use(auth);
router.post("/start", whatsappController.startWhatsApp);
router.post("/restart", whatsappController.restartWhatsAppSession);
router.post("/delete", whatsappController.deleteWhatsAppSession);

module.exports = router;
