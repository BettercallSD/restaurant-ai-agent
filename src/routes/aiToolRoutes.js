const express = require('express');
const controller = require('../controllers/aiToolController');
const { validate } = require('../middleware/validate');
const v = require('../validators/aiToolValidators');

const router = express.Router();

// One route per tool in docs/AI_TOOLS.md, each: validate -> controller.<tool> (which logs to
// ai_actions and shapes the response — see aiToolController.js). authenticate + requireAiActor
// are applied once, at the mount point in routes/index.js, not per-route here.
router.post('/get-restaurant-info', validate(v.emptySchema), controller.getRestaurantInfo);
router.post('/get-menu', validate(v.getMenuToolSchema), controller.getMenu);
router.post('/check-item-availability', validate(v.checkItemAvailabilitySchema), controller.checkItemAvailability);
router.post('/check-table-availability', validate(v.checkTableAvailabilitySchema), controller.checkTableAvailability);
router.post('/find-alternative-times', validate(v.findAlternativeTimesSchema), controller.findAlternativeTimes);
router.post('/create-reservation', validate(v.createReservationToolSchema), controller.createReservation);
router.post('/get-reservation', validate(v.getReservationToolSchema), controller.getReservation);
router.post('/modify-reservation', validate(v.modifyReservationToolSchema), controller.modifyReservation);
router.post('/cancel-reservation', validate(v.cancelReservationToolSchema), controller.cancelReservation);
router.post('/create-order', validate(v.createOrderToolSchema), controller.createOrder);
router.post('/modify-order', validate(v.modifyOrderToolSchema), controller.modifyOrder);
router.post('/cancel-order', validate(v.cancelOrderToolSchema), controller.cancelOrder);
router.post('/transfer-to-human', validate(v.transferToHumanSchema), controller.transferToHuman);

module.exports = router;
