const { pool } = require('../db/pool');

const mapCategory = (row) => ({ id: row.id, name: row.name, displayOrder: row.display_order });

const mapItem = (row) => ({
  id: row.id,
  categoryId: row.category_id,
  name: row.name,
  description: row.description,
  priceCents: row.price_cents,
  isAvailable: row.is_available,
});

async function listCategories(restaurantId, executor = pool) {
  const result = await executor.query(
    `SELECT id, name, display_order FROM menu_categories WHERE restaurant_id = $1 ORDER BY display_order`,
    [restaurantId]
  );
  return result.rows.map(mapCategory);
}

async function listItems(restaurantId, { categoryId } = {}, executor = pool) {
  const result = categoryId
    ? await executor.query(
        `SELECT id, category_id, name, description, price_cents, is_available
         FROM menu_items
         WHERE restaurant_id = $1 AND category_id = $2
         ORDER BY name`,
        [restaurantId, categoryId]
      )
    : await executor.query(
        `SELECT id, category_id, name, description, price_cents, is_available
         FROM menu_items
         WHERE restaurant_id = $1
         ORDER BY name`,
        [restaurantId]
      );
  return result.rows.map(mapItem);
}

async function categoryExists(restaurantId, categoryId, executor = pool) {
  const result = await executor.query(
    `SELECT 1 FROM menu_categories WHERE id = $1 AND restaurant_id = $2`,
    [categoryId, restaurantId]
  );
  return result.rowCount > 0;
}

/**
 * Tenant-scoped single lookup — always filters by `restaurant_id` too, not just the item id, so a
 * menuItemId from one restaurant can never resolve against another restaurant's data (see the
 * multi-tenant note in docs/ARCHITECTURE.md). Used before pricing an order line, never trusting
 * any price the caller (customer, AI, or client) might have supplied.
 */
async function findByIdForRestaurant(id, restaurantId, executor = pool) {
  const result = await executor.query(
    `SELECT id, category_id, name, description, price_cents, is_available
     FROM menu_items
     WHERE id = $1 AND restaurant_id = $2`,
    [id, restaurantId]
  );
  return result.rows[0] ? mapItem(result.rows[0]) : null;
}

/**
 * Batch version of the above for pricing a whole order's line items in one query instead of N.
 */
async function findByIdsForRestaurant(ids, restaurantId, executor = pool) {
  const result = await executor.query(
    `SELECT id, category_id, name, description, price_cents, is_available
     FROM menu_items
     WHERE id = ANY($1::uuid[]) AND restaurant_id = $2`,
    [ids, restaurantId]
  );
  return result.rows.map(mapItem);
}

module.exports = {
  listCategories,
  listItems,
  categoryExists,
  findByIdForRestaurant,
  findByIdsForRestaurant,
};
