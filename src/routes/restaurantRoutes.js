const express = require('express');
const controller = require('../controllers/restaurantController');
const { resolveRestaurant } = require('../middleware/resolveRestaurant');
const reservationRoutes = require('./reservationRoutes');
const orderRoutes = require('./orderRoutes');
const sessionRoutes = require('./sessionRoutes');

const router = express.Router();

router.get('/:restaurantId', resolveRestaurant, controller.getRestaurant);
router.get('/:restaurantId/tables', resolveRestaurant, controller.listTables);
router.get('/:restaurantId/menu', resolveRestaurant, controller.listMenu);
router.use('/:restaurantId/reservations', resolveRestaurant, reservationRoutes);
router.use('/:restaurantId/orders', resolveRestaurant, orderRoutes);
router.use('/:restaurantId/sessions', resolveRestaurant, sessionRoutes);

module.exports = router;
