const { Pool, types } = require('pg');
const env = require('../config/env');

// The whole system treats reservation_date/reservation_time as restaurant-local wall-clock
// strings, never as real-world instants (see docs/DATABASE.md) — comparisons throughout the
// codebase rely on plain 'YYYY-MM-DD'/'HH:mm:ss' string ordering. `pg` parses DATE/TIME columns
// into JS Date objects by default, which would silently break every one of those string
// comparisons (and did, until this was added) and apply an unwanted implicit timezone shift.
// Overriding the parsers to return the raw text keeps every layer working with the same strings
// that are actually stored.
types.setTypeParser(types.builtins.DATE, (value) => value);
types.setTypeParser(types.builtins.TIME, (value) => value);

// Single shared connection pool for the whole process. Repositories import `query`/`withClient`
// from here rather than creating their own pools, so connection limits are respected app-wide.
const pool = new Pool({ connectionString: env.DATABASE_URL });

/**
 * Run a single parameterized query. Always use placeholders ($1, $2, ...) — never string-build
 * SQL with user/AI-supplied values. This is the only function most repository code needs.
 */
function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run `fn` with a dedicated client inside a transaction: BEGIN before, COMMIT on success,
 * ROLLBACK if `fn` throws. Use this whenever more than one write must succeed together
 * (e.g. creating an order and its line items), and for the reservation-allocation locking
 * transaction described in docs/DATABASE.md ("Preventing double-booking").
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
