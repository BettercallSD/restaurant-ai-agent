const { validationError } = require('../errors/AppError');

/**
 * Parses `req.body` against a zod schema and replaces it with the parsed (and type-coerced where
 * the schema says so) result, so controllers can trust the shape completely — no more ad hoc
 * presence/type checks scattered through controller code. An unrecognized extra field (e.g. a
 * client trying to set `status` or `restaurantId`) is silently stripped by zod's default
 * behavior, not rejected — matching docs/SECURITY.md's mass-assignment stance of "ignored, not
 * applied" rather than erroring on it.
 */
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`)
      .join('; ');
    return next(validationError(message));
  }
  req.body = result.data;
  next();
};

module.exports = { validate };
