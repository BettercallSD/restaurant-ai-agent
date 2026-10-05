const express = require('express');
const controller = require('../controllers/reservationController');

// mergeParams: true so req.params.restaurantId (captured by the parent router's path) is visible
// here too — this router only ever gets mounted under /restaurants/:restaurantId/reservations.
const router = express.Router({ mergeParams: true });

router.post('/', controller.createReservation);
router.get('/:reservationId', controller.getReservation);
router.patch('/:reservationId', controller.modifyReservation);
router.post('/:reservationId/cancel', controller.cancelReservation);

module.exports = router;
