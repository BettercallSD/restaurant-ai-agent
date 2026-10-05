/**
 * Wraps an async route handler so a rejected promise reaches Express's error handling (`next(err)`)
 * instead of becoming an unhandled rejection. Without this, every controller would need its own
 * try/catch just to forward errors — this is the one place that boilerplate lives.
 */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { asyncHandler };
