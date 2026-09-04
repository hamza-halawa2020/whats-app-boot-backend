const express = require('express');
const router = express.Router();
const apiTokenAuth = require("../middlewares/apiTokenAuth");
const messageController = require('../controllers/messageController');
const walletController = require("../controllers/walletController");

router.use(apiTokenAuth);

router.post('/messages/send', messageController.sendMessageWithApiToken);
router.post('/messages/bulk', messageController.sendRandomMessages);
router.get('/wallet', walletController.getExternalWallet);

module.exports = router;
