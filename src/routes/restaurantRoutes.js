const express = require('express');
const controller = require('../controllers/restaurantController');
const { resolveRestaurant } = require('../middleware/resolveRestaurant');
const { authenticate } = require('../middleware/authenticate');
const { authorizeActor } = require('../middleware/authorizeActor');
const { validateUuidParam } = require('../middleware/validateParams');
const { validateQuery } = require('../middleware/validate');
const { listMenuQuerySchema } = require('../validators/restaurantValidators');
const { publicReadLimiter } = require('../middleware/rateLimiters');
const reservationRoutes = require('./reservationRoutes');
const orderRoutes = require('./orderRoutes');
const sessionRoutes = require('./sessionRoutes');

const router = express.Router();
const restaurantId = validateUuidParam('restaurantId');

// Public reads — a restaurant's own info/menu/tables aren't sensitive (same as a restaurant's
// public website), see docs/DECISIONS.md. Still rate-limited (Phase 17 audit caught this one
// missing — the brief calls out "public information" as its own limiter class).
router.get('/:restaurantId', restaurantId, publicReadLimiter, resolveRestaurant, controller.getRestaurant);
router.get('/:restaurantId/tables', restaurantId, publicReadLimiter, resolveRestaurant, controller.listTables);
router.get(
  '/:restaurantId/menu',
  restaurantId,
  publicReadLimiter,
  validateQuery(listMenuQuerySchema),
  resolveRestaurant,
  controller.listMenu
);

// Reservations and orders always touch a specific customer's data, so every route under them
// requires an authenticated, authorized actor (AI session token or staff JWT).
router.use('/:restaurantId/reservations', restaurantId, resolveRestaurant, authenticate, authorizeActor, reservationRoutes);
router.use('/:restaurantId/orders', restaurantId, resolveRestaurant, authenticate, authorizeActor, orderRoutes);

// Sessions only need the restaurant resolved here — the create route is intentionally public
// (it's what issues the aiToken), and every other session route applies authenticate +
// authorizeActor itself, scoped further to the specific session (see sessionController.js).
router.use('/:restaurantId/sessions', restaurantId, resolveRestaurant, sessionRoutes);

module.exports = router;
