const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const auth = require("../middlewares/auth");

router.post("/signup", authController.signup);
router.post("/register", authController.signup);
router.post("/verify-otp", authController.verifyOtp);
router.post("/resend-otp", authController.resendOtp);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);
router.post("/login", authController.login);

router.use(auth);
router.get("/me", authController.me);
router.patch("/me", authController.updateMe);
router.post("/logout", authController.logout);

module.exports = router;
