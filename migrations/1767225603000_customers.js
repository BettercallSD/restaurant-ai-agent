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
  pgm.createTable('customers', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    restaurant_id: { type: 'uuid', notNull: true, references: 'restaurants', onDelete: 'CASCADE' },
    phone: { type: 'text', notNull: true },
    name: { type: 'text' },
    ...timestampColumns(pgm),
  });
  pgm.addConstraint('customers', 'customers_restaurant_phone_unique', {
    unique: ['restaurant_id', 'phone'],
  });
  attachUpdatedAtTrigger(pgm, 'customers');
};

exports.down = (pgm) => {
  pgm.dropTable('customers');
};
