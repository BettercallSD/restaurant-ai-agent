/* eslint-disable camelcase */

exports.shorthands = undefined;

const timestampColumns = (pgm) => ({
  created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
});

const attachUpdatedAtTrigger = (pgm, table) => {
  pgm.createTrigger(table, `${table}_set_updated_at`, {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at',
  });
};

exports.up = (pgm) => {
  pgm.createTable('orders', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    restaurant_id: { type: 'uuid', notNull: true, references: 'restaurants', onDelete: 'CASCADE' },
    customer_id: { type: 'uuid', notNull: true, references: 'customers', onDelete: 'RESTRICT' },
    reservation_id: { type: 'uuid', references: 'reservations', onDelete: 'SET NULL' },
    status: {
      type: 'text',
      notNull: true,
      default: 'PENDING',
      check: "status IN ('PENDING','CONFIRMED','PREPARING','COMPLETED','CANCELLED')",
    },
    subtotal_cents: { type: 'integer', notNull: true, check: 'subtotal_cents >= 0' },
    total_cents: { type: 'integer', notNull: true, check: 'total_cents >= 0' },
    idempotency_key: { type: 'text' },
    ...timestampColumns(pgm),
  });
  pgm.addConstraint('orders', 'orders_restaurant_idempotency_unique', {
    unique: ['restaurant_id', 'idempotency_key'],
  });
  pgm.createIndex('orders', ['restaurant_id', 'status']);
  attachUpdatedAtTrigger(pgm, 'orders');

  pgm.createTable('order_items', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    order_id: { type: 'uuid', notNull: true, references: 'orders', onDelete: 'CASCADE' },
    menu_item_id: { type: 'uuid', notNull: true, references: 'menu_items', onDelete: 'RESTRICT' },
    quantity: { type: 'integer', notNull: true, check: 'quantity > 0' },
    // Snapshotted from menu_items.price_cents at order-creation time — never recomputed from a
    // live join, so a later menu price change never rewrites a historical order's total.
    unit_price_cents: { type: 'integer', notNull: true, check: 'unit_price_cents >= 0' },
    line_total_cents: { type: 'integer', notNull: true, check: 'line_total_cents >= 0' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('order_items', ['order_id']);
};

exports.down = (pgm) => {
  pgm.dropTable('order_items');
  pgm.dropTable('orders');
};
