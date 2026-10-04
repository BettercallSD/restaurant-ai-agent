const { pool } = require('../db/pool');

const mapCustomer = (row) => ({ id: row.id, restaurantId: row.restaurant_id, phone: row.phone, name: row.name });

/**
 * A customer here is just "a phone number this restaurant has talked to before" — there is no
 * login. `ON CONFLICT ... DO UPDATE` makes this atomic even under concurrent calls from the same
 * number (e.g. a dropped call retried immediately): the unique (restaurant_id, phone) constraint
 * means Postgres resolves the race itself, no extra locking needed for this one.
 */
async function findOrCreate(restaurantId, phone, name, executor = pool) {
  const result = await executor.query(
    `INSERT INTO customers (restaurant_id, phone, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (restaurant_id, phone)
     DO UPDATE SET name = COALESCE(EXCLUDED.name, customers.name)
     RETURNING id, restaurant_id, phone, name`,
    [restaurantId, phone, name ?? null]
  );
  return mapCustomer(result.rows[0]);
}

async function findByPhone(restaurantId, phone, executor = pool) {
  const result = await executor.query(
    `SELECT id, restaurant_id, phone, name FROM customers WHERE restaurant_id = $1 AND phone = $2`,
    [restaurantId, phone]
  );
  return result.rows[0] ? mapCustomer(result.rows[0]) : null;
}

module.exports = { findOrCreate, findByPhone };
