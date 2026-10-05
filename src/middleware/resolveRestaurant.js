const restaurantRepository = require('../repositories/restaurantRepository');
const { notFound } = require('../errors/AppError');
const { asyncHandler } = require('./asyncHandler');

/**
 * Loads the restaurant named by the URL's `:restaurantId` onto `req.restaurant`, 404ing if it
 * doesn't exist or is inactive. This is purely "does this restaurant exist" — it does NOT check
 * whether the caller may act on it. For public read routes (restaurant info, menu, tables) that's
 * the whole story. For anything else, this middleware is followed by `authenticate` +
 * `authorizeActor`, which add the actual multi-tenant authorization check on top (see
 * docs/ARCHITECTURE.md) — don't use this alone to guard a sensitive route.
 */
const resolveRestaurant = asyncHandler(async (req, res, next) => {
  const restaurant = await restaurantRepository.findById(req.params.restaurantId);
  if (!restaurant || !restaurant.isActive) {
    throw notFound('Restaurant');
  }
  req.restaurant = restaurant;
  next();
});

module.exports = { resolveRestaurant };
