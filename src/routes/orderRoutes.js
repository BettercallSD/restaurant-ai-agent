const express = require('express');
const controller = require('../controllers/orderController');

const router = express.Router({ mergeParams: true });

router.post('/', controller.createOrder);
router.get('/:orderId', controller.getOrder);
router.patch('/:orderId', controller.modifyOrder);
router.post('/:orderId/cancel', controller.cancelOrder);

module.exports = router;
