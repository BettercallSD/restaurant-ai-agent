/**
 * The only kind of error any controller/service/repository should throw on purpose. The
 * centralized Express error handler (added in Phase 11) knows how to turn one of these into the
 * safe `{ success: false, error: { code, message } }` envelope documented in
 * docs/ERROR_HANDLING.md. Anything thrown that is NOT an AppError is treated as unexpected and
 * never has its message shown to the client.
 */
class AppError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// Factory helpers for the common cases, so call sites read as `throw notFound('reservation')`
// instead of repeating a status code/error code pair that's easy to get wrong.
const notFound = (resource = 'Resource') =>
  new AppError('NOT_FOUND', `${resource} not found.`, 404);

const validationError = (message) => new AppError('VALIDATION_ERROR', message, 400);

const forbidden = (message = 'You do not have access to this resource.') =>
  new AppError('FORBIDDEN', message, 403);

const unauthorized = (message = 'Authentication required.') =>
  new AppError('UNAUTHORIZED', message, 401);

const conflict = (code, message) => new AppError(code, message, 409);

module.exports = { AppError, notFound, validationError, forbidden, unauthorized, conflict };
