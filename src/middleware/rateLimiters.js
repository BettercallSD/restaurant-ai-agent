const rateLimit = require('express-rate-limit');

/**
 * Separate limits per endpoint class (docs/SECURITY.md), using the in-memory store that ships
 * with express-rate-limit — fine for a single-instance hackathon deployment; a multi-instance
 * production deployment would need a shared store (e.g. Redis) instead, since each instance
 * otherwise counts independently.
 *
 * Limits are generous enough not to break a live demo (a judge clicking through a flow quickly
 * should never hit one) while still meaningfully slowing down scripted abuse.
 */
const jsonRateLimitResponse = (req, res) => {
  res.status(429).json({
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' },
  });
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitResponse,
});

// Unauthenticated by nature (it's the credential-issuing endpoint — see
// docs/DECISIONS.md "Session creation is intentionally public in v1") so it gets its own,
// stricter-than-authenticated-mutation limit.
const sessionCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitResponse,
});

const mutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitResponse,
});

// A single conversation turn can involve several tool calls (check availability, then book, for
// example), so this is more generous than mutationLimiter — scoped per IP, same as the others.
const aiToolLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitResponse,
});

module.exports = { authLimiter, sessionCreateLimiter, mutationLimiter, aiToolLimiter };
