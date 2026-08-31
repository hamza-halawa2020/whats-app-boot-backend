const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const walletController = require("../controllers/walletController");

router.use(auth);
router.get("/", walletController.getWallet);
router.get("/transactions", walletController.getTransactions);

module.exports = router;
