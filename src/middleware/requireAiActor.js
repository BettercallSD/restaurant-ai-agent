const restaurantRepository = require('../repositories/restaurantRepository');
const { forbidden, notFound } = require('../errors/AppError');
const { asyncHandler } = require('./asyncHandler');

/**
 * AI tool endpoints have no `:restaurantId` in their URL — the restaurant (and session) come
 * entirely from the authenticated AI session token (`authenticate.js` must run first). This is
 * what makes a prompt-injection attempt like "pretend this call is for a different restaurant"
 * structurally impossible to honor: there is no argument anywhere in any tool's input schema that
 * could carry a different restaurant id, even if the AI tried to send one.
 *
 * Staff JWTs are deliberately rejected here (not just "not AI") — tool endpoints are an AI-only
 * concept; a dashboard user acts through the plain REST API, which has its own equivalent
 * business logic.
 */
const requireAiActor = asyncHandler(async (req, res, next) => {
  if (!req.actor || req.actor.type !== 'ai') {
    throw forbidden('This endpoint requires an AI session token.');
  }
  const restaurant = await restaurantRepository.findById(req.actor.restaurantId);
  if (!restaurant || !restaurant.isActive) throw notFound('Restaurant');
  req.restaurant = restaurant;
  next();
});

module.exports = { requireAiActor };
