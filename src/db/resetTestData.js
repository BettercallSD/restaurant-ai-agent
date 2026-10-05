/**
 * Truncates every table the test suite writes to, leaving the static seed data (restaurants,
 * tables, menu_categories, menu_items, users, restaurant_users) untouched. Run before `npm test`'s
 * seed step so every invocation starts from an identical, deterministic baseline.
 *
 * Why this exists: tests pick a random future date per run specifically so re-running the suite
 * never collides with a previous run's own leftover rows (see the integration test files' top
 * comments) — but across *enough* repeated runs in the same session, a random collision became
 * observable in practice (a test's "book every table" setup found some already booked from an
 * earlier run that happened to pick the same date). Wider random ranges only make collisions
 * rarer, not impossible, and an ever-growing test database is bad practice regardless. Resetting
 * before every run removes the root cause instead of just making it less likely.
 *
 * Guarded to only ever run with NODE_ENV=test — this truncates data, and the whole point is that
 * it must never be reachable against a real database.
 */
require('dotenv').config();
const { pool } = require('./pool');

async function resetTestData() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetTestData refuses to run outside NODE_ENV=test — this truncates tables.');
  }
  await pool.query(`
    TRUNCATE TABLE
      ai_actions,
      audit_logs,
      conversation_messages,
      conversation_sessions,
      order_items,
      orders,
      reservation_tables,
      reservations,
      customers
    CASCADE
  `);
}

if (require.main === module) {
  resetTestData()
    .then(() => {
      console.log('Test data reset.');
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
      return pool.end();
    });
}

module.exports = { resetTestData };
