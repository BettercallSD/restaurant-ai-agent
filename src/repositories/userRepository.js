const { pool } = require('../db/pool');

/**
 * `findByEmail` is the only function here that returns `password_hash` — it exists specifically
 * for the login flow to compare against. Every other lookup omits it, so a password hash can
 * never leak into a response by accident just because some other code path reused the wrong
 * function.
 */
async function findByEmail(email, executor = pool) {
  const result = await executor.query(
    `SELECT id, email, password_hash, name, is_platform_admin FROM users WHERE email = $1`,
    [email]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    name: row.name,
    isPlatformAdmin: row.is_platform_admin,
  };
}

async function findById(id, executor = pool) {
  const result = await executor.query(
    `SELECT id, email, name, is_platform_admin FROM users WHERE id = $1`,
    [id]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return { id: row.id, email: row.email, name: row.name, isPlatformAdmin: row.is_platform_admin };
}

module.exports = { findByEmail, findById };
