const { pool } = require('../db/pool');

const mapTable = (row) => ({ id: row.id, label: row.label, capacity: row.capacity });

/**
 * Every active table for a restaurant, smallest capacity first. This is the raw candidate set the
 * table-allocation algorithm (Phase 7/8 service) picks from — "exact fit, then smallest suitable,
 * then an allowed combination" is business logic that belongs in the service, not here; this
 * repository only answers "what tables exist".
 */
async function listActive(restaurantId, executor = pool) {
  const result = await executor.query(
    `SELECT id, label, capacity
     FROM tables
     WHERE restaurant_id = $1 AND is_active = true
     ORDER BY capacity ASC`,
    [restaurantId]
  );
  return result.rows.map(mapTable);
}

/**
 * Locks the given table rows for the duration of the caller's transaction. MUST be called with a
 * transaction client (not the plain pool) — a `FOR UPDATE` lock taken outside an explicit
 * transaction is released the instant this statement finishes, which defeats the whole point.
 * See docs/DATABASE.md "Preventing double-booking" for why this specific lock is what makes the
 * allocation check-then-insert sequence actually safe under concurrency.
 */
async function lockByIds(tableIds, client) {
  const result = await client.query(
    `SELECT id, capacity FROM tables WHERE id = ANY($1::uuid[]) FOR UPDATE`,
    [tableIds]
  );
  return result.rows.map((row) => ({ id: row.id, capacity: row.capacity }));
}

/** Full table details (label, capacity) for a known set of ids — e.g. displaying a reservation's
 * assigned tables, where only the bare ids were persisted in `reservation_tables`. */
async function findByIds(tableIds, executor = pool) {
  if (tableIds.length === 0) return [];
  const result = await executor.query(`SELECT id, label, capacity FROM tables WHERE id = ANY($1::uuid[])`, [
    tableIds,
  ]);
  return result.rows.map(mapTable);
}

module.exports = { listActive, lockByIds, findByIds };
