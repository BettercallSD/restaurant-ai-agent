const { pool } = require('../db/pool');

const mapOrder = (row) => ({
  id: row.id,
  restaurantId: row.restaurant_id,
  customerId: row.customer_id,
  reservationId: row.reservation_id,
  status: row.status,
  subtotalCents: row.subtotal_cents,
  totalCents: row.total_cents,
  idempotencyKey: row.idempotency_key,
});

const mapOrderItem = (row) => ({
  id: row.id,
  orderId: row.order_id,
  menuItemId: row.menu_item_id,
  quantity: row.quantity,
  unitPriceCents: row.unit_price_cents,
  lineTotalCents: row.line_total_cents,
});

async function insert(
  { restaurantId, customerId, reservationId, subtotalCents, totalCents, idempotencyKey, status },
  client
) {
  const result = await client.query(
    `INSERT INTO orders (restaurant_id, customer_id, reservation_id, status, subtotal_cents, total_cents, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, restaurant_id, customer_id, reservation_id, status, subtotal_cents, total_cents, idempotency_key`,
    [restaurantId, customerId, reservationId ?? null, status, subtotalCents, totalCents, idempotencyKey ?? null]
  );
  return mapOrder(result.rows[0]);
}

/**
 * `unitPriceCents`/`lineTotalCents` must already be computed by the service from the database's
 * own `menu_items.price_cents` before calling this — this repository has no opinion on pricing,
 * it just persists whatever numbers it's given. See docs/DECISIONS.md on price snapshotting.
 */
async function insertItems(orderId, items, client) {
  for (const item of items) {
    await client.query(
      `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_cents, line_total_cents)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, item.menuItemId, item.quantity, item.unitPriceCents, item.lineTotalCents]
    );
  }
}

async function clearItems(orderId, client) {
  await client.query(`DELETE FROM order_items WHERE order_id = $1`, [orderId]);
}

async function findItemsByOrderId(orderId, executor = pool) {
  const result = await executor.query(
    `SELECT id, order_id, menu_item_id, quantity, unit_price_cents, line_total_cents
     FROM order_items
     WHERE order_id = $1`,
    [orderId]
  );
  return result.rows.map(mapOrderItem);
}

async function findByIdempotencyKey(restaurantId, idempotencyKey, executor = pool) {
  if (!idempotencyKey) return null;
  const result = await executor.query(
    `SELECT id, restaurant_id, customer_id, reservation_id, status, subtotal_cents, total_cents, idempotency_key
     FROM orders
     WHERE restaurant_id = $1 AND idempotency_key = $2`,
    [restaurantId, idempotencyKey]
  );
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

async function findByIdForRestaurant(id, restaurantId, executor = pool) {
  const result = await executor.query(
    `SELECT id, restaurant_id, customer_id, reservation_id, status, subtotal_cents, total_cents, idempotency_key
     FROM orders
     WHERE id = $1 AND restaurant_id = $2`,
    [id, restaurantId]
  );
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

async function updateStatus(id, restaurantId, status, client) {
  const result = await client.query(
    `UPDATE orders
     SET status = $3
     WHERE id = $1 AND restaurant_id = $2
     RETURNING id, restaurant_id, customer_id, reservation_id, status, subtotal_cents, total_cents, idempotency_key`,
    [id, restaurantId, status]
  );
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

async function updateTotals(id, restaurantId, { subtotalCents, totalCents }, client) {
  const result = await client.query(
    `UPDATE orders
     SET subtotal_cents = $3, total_cents = $4
     WHERE id = $1 AND restaurant_id = $2
     RETURNING id, restaurant_id, customer_id, reservation_id, status, subtotal_cents, total_cents, idempotency_key`,
    [id, restaurantId, subtotalCents, totalCents]
  );
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

/**
 * Dashboard list, newest first. `date` is matched against the order's creation day in the
 * restaurant's own timezone, so "today's orders" means the restaurant's today, not UTC's.
 */
async function listForDashboard(restaurantId, timezone, { date } = {}, executor = pool) {
  const orders = await executor.query(
    `SELECT o.id, o.reservation_id, o.status, o.subtotal_cents, o.total_cents, o.created_at,
            c.name AS customer_name, c.phone AS customer_phone
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     WHERE o.restaurant_id = $1
       AND ($2::date IS NULL OR (o.created_at AT TIME ZONE $3)::date = $2::date)
     ORDER BY o.created_at DESC
     LIMIT 500`,
    [restaurantId, date ?? null, timezone]
  );
  if (orders.rows.length === 0) return [];

  const items = await executor.query(
    `SELECT oi.order_id, oi.menu_item_id, mi.name, oi.quantity, oi.unit_price_cents, oi.line_total_cents
     FROM order_items oi
     JOIN menu_items mi ON mi.id = oi.menu_item_id
     WHERE oi.order_id = ANY($1::uuid[])`,
    [orders.rows.map((row) => row.id)]
  );
  const itemsByOrder = new Map();
  for (const row of items.rows) {
    if (!itemsByOrder.has(row.order_id)) itemsByOrder.set(row.order_id, []);
    itemsByOrder.get(row.order_id).push({
      menuItemId: row.menu_item_id,
      name: row.name,
      quantity: row.quantity,
      unitPriceCents: row.unit_price_cents,
      lineTotalCents: row.line_total_cents,
    });
  }

  return orders.rows.map((row) => ({
    id: row.id,
    reservationId: row.reservation_id,
    status: row.status,
    subtotalCents: row.subtotal_cents,
    totalCents: row.total_cents,
    createdAt: row.created_at,
    customer: { name: row.customer_name, phone: row.customer_phone },
    items: itemsByOrder.get(row.id) ?? [],
  }));
}

module.exports = {
  listForDashboard,
  insert,
  insertItems,
  clearItems,
  findItemsByOrderId,
  findByIdempotencyKey,
  findByIdForRestaurant,
  updateStatus,
  updateTotals,
};
