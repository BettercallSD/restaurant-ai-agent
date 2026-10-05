const { validationError } = require('../errors/AppError');
const { uuid } = require('../validators/common');

/**
 * Validates a URL param is a well-formed UUID before anything downstream touches the database.
 * Without this, a malformed id (`../../etc/passwd`, `' OR '1'='1`, a random non-UUID string)
 * reaches a repository's `WHERE id = $1` as a plain parameter — safe from injection either way
 * (it's parameterized), but Postgres rejects a non-UUID value for a `uuid` column with a raw
 * driver error, which would otherwise surface as an opaque 500 instead of a clean 400.
 */
const validateUuidParam = (paramName) => (req, res, next) => {
  const result = uuid.safeParse(req.params[paramName]);
  if (!result.success) {
    return next(validationError(`${paramName} must be a valid UUID.`));
  }
  next();
};

module.exports = { validateUuidParam };
