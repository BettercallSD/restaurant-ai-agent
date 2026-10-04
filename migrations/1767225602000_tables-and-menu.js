/* eslint-disable camelcase */

exports.shorthands = undefined;

// Deliberately duplicated per-migration (not imported from a shared file): migrations are
// historical snapshots, and a shared helper that changes later would silently alter the meaning
// of migrations that already ran. See migrations 1-2 for the same pattern.
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
  pgm.createTable('tables', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    restaurant_id: { type: 'uuid', notNull: true, references: 'restaurants', onDelete: 'CASCADE' },
    label: { type: 'text', notNull: true },
    capacity: { type: 'integer', notNull: true, check: 'capacity > 0' },
    is_active: { type: 'boolean', notNull: true, default: true },
    ...timestampColumns(pgm),
  });
  // Matches exactly the lookup the table-allocation algorithm performs (docs/DATABASE.md).
  pgm.createIndex('tables', ['restaurant_id', 'is_active', 'capacity']);
  attachUpdatedAtTrigger(pgm, 'tables');

  pgm.createTable('menu_categories', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    restaurant_id: { type: 'uuid', notNull: true, references: 'restaurants', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    display_order: { type: 'integer', notNull: true, default: 0 },
    ...timestampColumns(pgm),
  });
  pgm.createIndex('menu_categories', 'restaurant_id');
  attachUpdatedAtTrigger(pgm, 'menu_categories');

  pgm.createTable('menu_items', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    restaurant_id: { type: 'uuid', notNull: true, references: 'restaurants', onDelete: 'CASCADE' },
    category_id: { type: 'uuid', notNull: true, references: 'menu_categories', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    description: { type: 'text' },
    price_cents: { type: 'integer', notNull: true, check: 'price_cents >= 0' },
    is_available: { type: 'boolean', notNull: true, default: true },
    ...timestampColumns(pgm),
  });
  pgm.createIndex('menu_items', ['restaurant_id', 'is_available']);
  attachUpdatedAtTrigger(pgm, 'menu_items');
};

exports.down = (pgm) => {
  pgm.dropTable('menu_items');
  pgm.dropTable('menu_categories');
  pgm.dropTable('tables');
};
