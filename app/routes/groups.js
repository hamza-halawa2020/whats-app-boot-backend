const express = require('express');
const router = express.Router();
const groupsController = require('../controllers/groupsController');
const auth = require("../middlewares/auth");


router.get('/',auth, groupsController.getGroups);
router.get('/:groupId/participants', auth, groupsController.getGroupParticipants);

module.exports = router;