const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const admin = require("../middlewares/admin");
const adminUserController = require("../controllers/adminUserController");

router.use(auth, admin);
router.get("/", adminUserController.listUsers);
router.post("/", adminUserController.createUser);
router.get("/:id/wallet/transactions", adminUserController.getUserWalletTransactions);
router.post("/:id/wallet/credit", adminUserController.creditUserWallet);
router.post("/:id/wallet/debit", adminUserController.debitUserWallet);
router.patch("/:id/role", adminUserController.updateUserRole);

module.exports = router;
