const { Pool } = require('pg');
const env = require('../config/env');

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
 * (e.g. creating an order and its line items) — see docs/DATABASE.md for the concurrency notes
 * on why reservations additionally rely on a database-level exclusion constraint rather than
 * transaction isolation alone.
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
