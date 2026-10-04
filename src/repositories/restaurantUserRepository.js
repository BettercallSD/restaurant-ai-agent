const { pool } = require('../db/pool');

/**
 * This is the table authorization is actually derived from (see docs/ARCHITECTURE.md's
 * multi-tenant security boundary) — a staff JWT identifies a user, and this repository answers
 * "which restaurant(s) is this user actually allowed to act on, and in what role", never the
 * other way around.
 */

async function findRole(userId, restaurantId, executor = pool) {
  const result = await executor.query(
    `SELECT role FROM restaurant_users WHERE user_id = $1 AND restaurant_id = $2`,
    [userId, restaurantId]
  );
  return result.rows[0]?.role ?? null;
}

async function listForUser(userId, executor = pool) {
  const result = await executor.query(
    `SELECT restaurant_id, role FROM restaurant_users WHERE user_id = $1`,
    [userId]
  );
  return result.rows.map((row) => ({ restaurantId: row.restaurant_id, role: row.role }));
}

module.exports = { findRole, listForUser };
