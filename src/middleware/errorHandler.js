const { AppError } = require('../errors/AppError');
const { logger } = require('../config/logger');

/**
 * The single place that turns an error into an HTTP response, matching the envelope in
 * docs/ERROR_HANDLING.md exactly. An AppError was thrown on purpose with a response we intend the
 * client to see (its message and `details` are safe by construction — see AppError.js). Anything
 * else is unexpected: logged with full detail server-side, but the client only ever gets a
 * generic message — no stack trace, no SQL, no file path, in any environment, so there's no
 * "debug mode" flag that could accidentally be left on during a live demo.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message },
      ...(err.details || {}),
    });
  }

  // `req.log` (set by pino-http in app.js) is already bound to this request's id, so the line
  // below is automatically correlated with the access-log line for the same request — no manual
  // request-id plumbing needed. Falls back to the shared logger for the rare case this handler
  // runs outside pino-http's middleware chain (e.g. a unit test that builds a bare Express app).
  (req.log || logger).error({ err }, 'Unexpected error');
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' },
  });
}

module.exports = { errorHandler };
