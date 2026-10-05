const express = require('express');
const controller = require('../controllers/orderController');
const { validate } = require('../middleware/validate');
const { validateUuidParam } = require('../middleware/validateParams');
const { createOrderSchema, modifyOrderSchema } = require('../validators/orderValidators');
const { mutationLimiter } = require('../middleware/rateLimiters');

const router = express.Router({ mergeParams: true });

router.post('/', mutationLimiter, validate(createOrderSchema), controller.createOrder);
router.get('/:orderId', validateUuidParam('orderId'), controller.getOrder);
router.patch(
  '/:orderId',
  validateUuidParam('orderId'),
  mutationLimiter,
  validate(modifyOrderSchema),
  controller.modifyOrder
);
router.post('/:orderId/cancel', validateUuidParam('orderId'), mutationLimiter, controller.cancelOrder);

module.exports = router;
