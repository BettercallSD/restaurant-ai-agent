const restaurantUserRepository = require('../repositories/restaurantUserRepository');
const { notFound } = require('../errors/AppError');
const { asyncHandler } = require('./asyncHandler');

/**
 * Must run after `resolveRestaurant` (which sets `req.restaurant`, 404ing if it doesn't exist)
 * and `authenticate` (which sets `req.actor`). This is the actual multi-tenant boundary
 * (docs/ARCHITECTURE.md): an AI session token only authorizes the one restaurant it was issued
 * for; a staff JWT only authorizes restaurants that user has a `restaurant_users` row for.
 *
 * A mismatch is a 404 (`Restaurant`), not a 403 — this is the IDOR-safe choice from
 * docs/ERROR_HANDLING.md: a 403 would confirm "this restaurant exists, you're just not allowed",
 * which hands a cross-tenant prober free information a 404 doesn't.
 */
const authorizeActor = asyncHandler(async (req, res, next) => {
  if (req.actor.type === 'ai') {
    if (req.actor.restaurantId !== req.restaurant.id) throw notFound('Restaurant');
  } else if (req.actor.type === 'staff') {
    const role = await restaurantUserRepository.findRole(req.actor.userId, req.restaurant.id);
    if (!role) throw notFound('Restaurant');
    req.actor.role = role;
  } else {
    throw notFound('Restaurant');
  }
  next();
});

module.exports = { authorizeActor };
