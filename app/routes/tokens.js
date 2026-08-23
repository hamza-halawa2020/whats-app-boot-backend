const express = require('express');
const router = express.Router();
const auth = require("../middlewares/auth");
const messageController = require('../controllers/messageController');

router.use(auth);

router.post('/generate', messageController.generateApiToken);
router.get('/', messageController.getApiTokens);
router.put('/:tokenId', messageController.updateApiToken);
router.post('/:tokenId/rotate', messageController.rotateApiToken);
router.post('/revoke', messageController.revokeApiToken);

module.exports = router;
