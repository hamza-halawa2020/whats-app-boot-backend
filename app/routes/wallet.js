const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const walletController = require("../controllers/walletController");

router.use(auth);
router.get("/", walletController.getWallet);
router.get("/transactions", walletController.getTransactions);
router.get("/packages", walletController.getPointPackages);
router.post("/purchases", walletController.createPointPurchase);
router.get("/purchases", walletController.getPointPurchases);
router.get("/purchases/:id/proof", walletController.getPointPurchaseProof);
router.patch("/purchases/:id", walletController.updatePointPurchase);

module.exports = router;
