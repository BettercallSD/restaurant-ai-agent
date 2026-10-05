const express = require('express');
const controller = require('../controllers/sessionController');
const { validate } = require('../middleware/validate');
const { validateUuidParam } = require('../middleware/validateParams');
const { authenticate } = require('../middleware/authenticate');
const { authorizeActor } = require('../middleware/authorizeActor');
const { createSessionSchema, patchSessionStateSchema, appendMessageSchema } = require('../validators/sessionValidators');
const { sessionCreateLimiter } = require('../middleware/rateLimiters');

const router = express.Router({ mergeParams: true });

// Public by design — this is the credential-issuing endpoint (docs/DECISIONS.md). Everything
// below this line acts on an EXISTING session and requires the aiToken (or staff auth) this one
// hands back.
router.post('/', sessionCreateLimiter, validate(createSessionSchema), controller.createSession);

router.get('/:sessionId', validateUuidParam('sessionId'), authenticate, authorizeActor, controller.getSession);
router.patch(
  '/:sessionId',
  validateUuidParam('sessionId'),
  authenticate,
  authorizeActor,
  validate(patchSessionStateSchema),
  controller.patchSessionState
);
router.post(
  '/:sessionId/messages',
  validateUuidParam('sessionId'),
  authenticate,
  authorizeActor,
  validate(appendMessageSchema),
  controller.appendMessage
);

module.exports = router;
