const { forbidden } = require('../errors/AppError');

/**
 * Dashboard list views (every reservation/order/call for a restaurant) are staff-only. An AI
 * session token is scoped to one phone call; letting it list every customer's bookings would turn
 * a single prompt-injected caller into a bulk data export. Must run after `authorizeActor`.
 */
function requireStaffActor(req, res, next) {
  if (!req.actor || req.actor.type !== 'staff') {
    return next(forbidden('This endpoint requires a staff login.'));
  }
  next();
}

module.exports = { requireStaffActor };
