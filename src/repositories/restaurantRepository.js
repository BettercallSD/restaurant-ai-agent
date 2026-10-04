const { pool } = require('../db/pool');

/**
 * All repository functions take an optional `executor` (defaults to the shared pool) with a
 * `.query(text, params)` method. Services pass a transaction client here when a read needs to
 * happen inside a larger atomic operation; everything else just uses the default pool.
 */

const mapRestaurant = (row) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  phone: row.phone,
  timezone: row.timezone,
  openingHours: row.opening_hours,
  allowTableCombination: row.allow_table_combination,
  isActive: row.is_active,
});

async function findById(id, executor = pool) {
  const result = await executor.query(
    `SELECT id, name, slug, phone, timezone, opening_hours, allow_table_combination, is_active
     FROM restaurants
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? mapRestaurant(result.rows[0]) : null;
}

async function findBySlug(slug, executor = pool) {
  const result = await executor.query(
    `SELECT id, name, slug, phone, timezone, opening_hours, allow_table_combination, is_active
     FROM restaurants
     WHERE slug = $1`,
    [slug]
  );
  return result.rows[0] ? mapRestaurant(result.rows[0]) : null;
}

module.exports = { findById, findBySlug };
