const express = require('express');
const controller = require('../controllers/sessionController');

const router = express.Router({ mergeParams: true });

router.post('/', controller.createSession);
router.get('/:sessionId', controller.getSession);
router.patch('/:sessionId', controller.patchSessionState);
router.post('/:sessionId/messages', controller.appendMessage);

module.exports = router;
