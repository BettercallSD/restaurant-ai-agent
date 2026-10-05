/**
 * `pg` surfaces a unique-constraint violation as a plain Error with `.code` '23505' (Postgres's
 * unique_violation SQLSTATE) and `.constraint` naming the violated constraint — this is how a
 * genuine race on an idempotency key is told apart from any other unexpected database error.
 */
const isUniqueViolation = (err, constraintName) => err.code === '23505' && err.constraint === constraintName;

module.exports = { isUniqueViolation };
