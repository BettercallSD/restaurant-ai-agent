const restaurantRepository = require('../repositories/restaurantRepository');
const { notFound } = require('../errors/AppError');
const { asyncHandler } = require('./asyncHandler');

/**
 * ⚠️ TEMPORARY, Phase 10 only. This loads the restaurant purely from the URL's `:restaurantId`
 * with NO authorization check — it does not verify the caller is actually allowed to act on this
 * restaurant. Phase 11 inserts an auth middleware before this one (staff JWT -> restaurant_users,
 * or an AI session token -> conversation_sessions.restaurant_id) and this function changes to
 * cross-check the path param against what that middleware resolved, rejecting a mismatch with 403
 * rather than trusting the path blindly — see docs/ARCHITECTURE.md's multi-tenant security
 * boundary. Until Phase 11 lands, these routes are NOT tenant-isolated: anyone who can guess or
 * enumerate a restaurant id can act on it. Tracked in docs/DEVELOPMENT.md "Known issues".
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
