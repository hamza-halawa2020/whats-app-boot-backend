const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const whatsappController = require("../controllers/whatsappController");

router.use(auth);
router.get("/sessions", whatsappController.getSessions);
router.get("/status", whatsappController.getSessionStatus);
router.post("/start", whatsappController.startWhatsApp);
router.post("/qr/refresh", whatsappController.refreshQr);
router.post("/restart", whatsappController.restartWhatsAppSession);
router.post("/delete", whatsappController.deleteWhatsAppSession);

module.exports = router;
