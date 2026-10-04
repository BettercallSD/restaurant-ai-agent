const { pool } = require('../db/pool');

const mapReservation = (row) => ({
  id: row.id,
  restaurantId: row.restaurant_id,
  customerId: row.customer_id,
  partySize: row.party_size,
  date: row.reservation_date,
  time: row.reservation_time,
  durationMinutes: row.duration_minutes,
  status: row.status,
  specialRequests: row.special_requests,
  idempotencyKey: row.idempotency_key,
});

/**
 * Which of the given table ids are currently occupied by an overlapping, still-active
 * (PENDING/CONFIRMED) reservation. MUST be called with the same transaction `client` that is
 * holding the `FOR UPDATE` lock from tableRepository.lockByIds on these same table ids — see
 * docs/DATABASE.md. Without that lock, this is just a plain read with the same race window the
 * whole mechanism exists to close.
 *
 * `excludeReservationId` lets `modify_reservation` re-check availability for a new date/time
 * without the reservation's own current (soon-to-be-replaced) booking counting as a conflict with
 * itself.
 */
async function findOverlappingTableIds(client, tableIds, startAt, endAt, excludeReservationId = null) {
  const result = await client.query(
    `SELECT DISTINCT rt.table_id
     FROM reservation_tables rt
     JOIN reservations r ON r.id = rt.reservation_id
     WHERE rt.table_id = ANY($1::uuid[])
       AND r.status IN ('PENDING', 'CONFIRMED')
       AND r.time_range && tsrange($2::timestamp, $3::timestamp)
       AND ($4::uuid IS NULL OR r.id != $4)`,
    [tableIds, startAt, endAt, excludeReservationId]
  );
  return result.rows.map((row) => row.table_id);
}

async function insert(
  { restaurantId, customerId, partySize, date, time, durationMinutes, specialRequests, idempotencyKey, status },
  client
) {
  const result = await client.query(
    `INSERT INTO reservations
       (restaurant_id, customer_id, party_size, reservation_date, reservation_time,
        duration_minutes, special_requests, idempotency_key, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, restaurant_id, customer_id, party_size, reservation_date, reservation_time,
               duration_minutes, status, special_requests, idempotency_key`,
    [restaurantId, customerId, partySize, date, time, durationMinutes, specialRequests ?? null, idempotencyKey ?? null, status]
  );
  return mapReservation(result.rows[0]);
}

async function insertTables(reservationId, tableIds, client) {
  await client.query(
    `INSERT INTO reservation_tables (reservation_id, table_id)
     SELECT $1, unnest($2::uuid[])`,
    [reservationId, tableIds]
  );
}

/** Used by modify_reservation: drop the old table assignment, caller inserts the new one. */
async function clearTables(reservationId, client) {
  await client.query(`DELETE FROM reservation_tables WHERE reservation_id = $1`, [reservationId]);
}

async function findTableIdsForReservation(reservationId, executor = pool) {
  const result = await executor.query(
    `SELECT table_id FROM reservation_tables WHERE reservation_id = $1`,
    [reservationId]
  );
  return result.rows.map((row) => row.table_id);
}

async function findByIdempotencyKey(restaurantId, idempotencyKey, executor = pool) {
  if (!idempotencyKey) return null;
  const result = await executor.query(
    `SELECT id, restaurant_id, customer_id, party_size, reservation_date, reservation_time,
            duration_minutes, status, special_requests, idempotency_key
     FROM reservations
     WHERE restaurant_id = $1 AND idempotency_key = $2`,
    [restaurantId, idempotencyKey]
  );
  return result.rows[0] ? mapReservation(result.rows[0]) : null;
}

/** Tenant-scoped: a reservation id from another restaurant never resolves, by construction. */
async function findByIdForRestaurant(id, restaurantId, executor = pool) {
  const result = await executor.query(
    `SELECT id, restaurant_id, customer_id, party_size, reservation_date, reservation_time,
            duration_minutes, status, special_requests, idempotency_key
     FROM reservations
     WHERE id = $1 AND restaurant_id = $2`,
    [id, restaurantId]
  );
  return result.rows[0] ? mapReservation(result.rows[0]) : null;
}

async function findMostRecentActiveByPhone(restaurantId, phone, executor = pool) {
  const result = await executor.query(
    `SELECT r.id, r.restaurant_id, r.customer_id, r.party_size, r.reservation_date, r.reservation_time,
            r.duration_minutes, r.status, r.special_requests, r.idempotency_key
     FROM reservations r
     JOIN customers c ON c.id = r.customer_id
     WHERE r.restaurant_id = $1 AND c.phone = $2 AND r.status IN ('PENDING', 'CONFIRMED')
     ORDER BY r.reservation_date DESC, r.reservation_time DESC
     LIMIT 1`,
    [restaurantId, phone]
  );
  return result.rows[0] ? mapReservation(result.rows[0]) : null;
}

async function updateStatus(id, restaurantId, status, client) {
  const result = await client.query(
    `UPDATE reservations
     SET status = $3
     WHERE id = $1 AND restaurant_id = $2
     RETURNING id, restaurant_id, customer_id, party_size, reservation_date, reservation_time,
               duration_minutes, status, special_requests, idempotency_key`,
    [id, restaurantId, status]
  );
  return result.rows[0] ? mapReservation(result.rows[0]) : null;
}

async function updateSchedule(id, restaurantId, { partySize, date, time, durationMinutes }, client) {
  const result = await client.query(
    `UPDATE reservations
     SET party_size = $3, reservation_date = $4, reservation_time = $5, duration_minutes = $6
     WHERE id = $1 AND restaurant_id = $2
     RETURNING id, restaurant_id, customer_id, party_size, reservation_date, reservation_time,
               duration_minutes, status, special_requests, idempotency_key`,
    [id, restaurantId, partySize, date, time, durationMinutes]
  );
  return result.rows[0] ? mapReservation(result.rows[0]) : null;
}

module.exports = {
  findOverlappingTableIds,
  insert,
  insertTables,
  clearTables,
  findTableIdsForReservation,
  findByIdempotencyKey,
  findByIdForRestaurant,
  findMostRecentActiveByPhone,
  updateStatus,
  updateSchedule,
};
