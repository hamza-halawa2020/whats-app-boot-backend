const express = require('express');
const router = express.Router();
const auth = require("../middlewares/auth");
const messageController = require('../controllers/messageController');

router.use(auth);

router.post('/generate', messageController.generateApiToken);
router.get('/', messageController.getApiTokens);
router.post('/revoke', messageController.revokeApiToken);

module.exports = router;