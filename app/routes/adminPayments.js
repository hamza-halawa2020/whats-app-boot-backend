const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const admin = require("../middlewares/admin");
const adminPaymentController = require("../controllers/adminPaymentController");

router.use(auth, admin);
router.get("/packages", adminPaymentController.listPackages);
router.post("/packages", adminPaymentController.createPackage);
router.patch("/packages/:id", adminPaymentController.updatePackage);
router.get("/purchases", adminPaymentController.listPurchases);
router.patch("/purchases/:id/review", adminPaymentController.reviewPurchase);

module.exports = router;
