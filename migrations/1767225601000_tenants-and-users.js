/* eslint-disable camelcase */

exports.shorthands = undefined;

// Every table gets identical created_at/updated_at columns; updated_at is kept correct by the
// set_updated_at trigger (created in the previous migration) rather than application code.
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
  pgm.createTable('restaurants', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    slug: { type: 'text', notNull: true, unique: true },
    phone: { type: 'text' },
    timezone: { type: 'text', notNull: true, default: 'Asia/Kathmandu' },
    opening_hours: { type: 'jsonb', notNull: true, default: '{}' },
    allow_table_combination: { type: 'boolean', notNull: true, default: false },
    is_active: { type: 'boolean', notNull: true, default: true },
    ...timestampColumns(pgm),
  });
  attachUpdatedAtTrigger(pgm, 'restaurants');

  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email: { type: 'text', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    name: { type: 'text', notNull: true },
    is_platform_admin: { type: 'boolean', notNull: true, default: false },
    ...timestampColumns(pgm),
  });
  attachUpdatedAtTrigger(pgm, 'users');

  pgm.createTable('restaurant_users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    restaurant_id: {
      type: 'uuid',
      notNull: true,
      references: 'restaurants',
      onDelete: 'CASCADE',
    },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    role: { type: 'text', notNull: true, check: "role IN ('owner','manager','staff')" },
    ...timestampColumns(pgm),
  });
  pgm.addConstraint('restaurant_users', 'restaurant_users_restaurant_user_unique', {
    unique: ['restaurant_id', 'user_id'],
  });
  attachUpdatedAtTrigger(pgm, 'restaurant_users');
};

exports.down = (pgm) => {
  pgm.dropTable('restaurant_users');
  pgm.dropTable('users');
  pgm.dropTable('restaurants');
};
