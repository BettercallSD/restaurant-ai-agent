const express = require('express');
const controller = require('../controllers/reservationController');
const { validate, validateQuery } = require('../middleware/validate');
const { validateUuidParam } = require('../middleware/validateParams');
const { requireStaffActor } = require('../middleware/requireStaffActor');
const { createReservationSchema, modifyReservationSchema } = require('../validators/reservationValidators');
const { dashboardListQuerySchema } = require('../validators/restaurantValidators');
const { mutationLimiter } = require('../middleware/rateLimiters');

// mergeParams: true so req.params.restaurantId (captured by the parent router's path) is visible
// here too — this router only ever gets mounted under /restaurants/:restaurantId/reservations,
// behind authenticate + authorizeActor (see restaurantRoutes.js).
const router = express.Router({ mergeParams: true });

router.get('/', requireStaffActor, validateQuery(dashboardListQuerySchema), controller.listReservations);
router.post('/', mutationLimiter, validate(createReservationSchema), controller.createReservation);
router.get('/:reservationId', validateUuidParam('reservationId'), controller.getReservation);
router.patch(
  '/:reservationId',
  validateUuidParam('reservationId'),
  mutationLimiter,
  validate(modifyReservationSchema),
  controller.modifyReservation
);
router.post('/:reservationId/cancel', validateUuidParam('reservationId'), mutationLimiter, controller.cancelReservation);

module.exports = router;
