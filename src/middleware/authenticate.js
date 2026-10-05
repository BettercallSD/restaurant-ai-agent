const { verifyStaffToken, verifyAiSessionToken } = require('../utils/jwt');
const userRepository = require('../repositories/userRepository');
const { unauthorized } = require('../errors/AppError');
const { asyncHandler } = require('./asyncHandler');

/**
 * Sets `req.actor` to either `{ type: 'ai', sessionId, restaurantId }` or
 * `{ type: 'staff', userId, user }`. Tries the AI-session secret first, then the staff secret —
 * either outcome just determines which kind of token this is; a bearer token that matches neither
 * secret (missing, malformed, wrong secret, or expired) is rejected with the same generic 401 so
 * the response never reveals which check failed or why.
 *
 * Must run before `authorizeActor`, which assumes `req.actor` already exists.
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.get('Authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw unauthorized('Missing or malformed Authorization header.');
  }

  try {
    const payload = verifyAiSessionToken(token);
    req.actor = { type: 'ai', sessionId: payload.sessionId, restaurantId: payload.restaurantId };
    return next();
  } catch {
    // Not an AI session token (or it's expired/invalid) — fall through and try staff auth below.
  }

  let staffPayload;
  try {
    staffPayload = verifyStaffToken(token);
  } catch {
    throw unauthorized('Invalid or expired token.');
  }

  const user = await userRepository.findById(staffPayload.sub);
  if (!user) throw unauthorized('Invalid or expired token.');
  req.actor = { type: 'staff', userId: user.id, user };
  next();
});

module.exports = { authenticate };
