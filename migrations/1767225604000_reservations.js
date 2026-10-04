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
  pgm.createTable('reservations', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    restaurant_id: { type: 'uuid', notNull: true, references: 'restaurants', onDelete: 'CASCADE' },
    customer_id: { type: 'uuid', notNull: true, references: 'customers', onDelete: 'RESTRICT' },
    party_size: { type: 'integer', notNull: true, check: 'party_size > 0' },
    reservation_date: { type: 'date', notNull: true },
    reservation_time: { type: 'time', notNull: true },
    duration_minutes: { type: 'integer', notNull: true, default: 90, check: 'duration_minutes > 0' },
    status: {
      type: 'text',
      notNull: true,
      default: 'PENDING',
      check: "status IN ('PENDING','CONFIRMED','CANCELLED','COMPLETED','NO_SHOW')",
    },
    special_requests: { type: 'text' },
    idempotency_key: { type: 'text' },
    ...timestampColumns(pgm),
  });

  // Generated column used for overlap checks (`&&`) by the allocation/locking service. Stored
  // (not virtual) so it can be indexed and queried efficiently.
  pgm.sql(`
    ALTER TABLE reservations
    ADD COLUMN time_range tsrange
    GENERATED ALWAYS AS (
      tsrange(
        (reservation_date + reservation_time),
        (reservation_date + reservation_time) + (duration_minutes * interval '1 minute')
      )
    ) STORED;
  `);

  pgm.addConstraint('reservations', 'reservations_restaurant_idempotency_unique', {
    unique: ['restaurant_id', 'idempotency_key'],
  });
  pgm.createIndex('reservations', ['restaurant_id', 'reservation_date', 'status']);
  pgm.createIndex('reservations', ['customer_id']);
  attachUpdatedAtTrigger(pgm, 'reservations');

  // Join table: which table(s) a reservation occupies. One row for the common single-table case,
  // several when seating was combined. See docs/DATABASE.md and docs/DECISIONS.md for why
  // double-booking safety is enforced via a locking transaction over this table rather than a
  // declarative constraint here.
  pgm.createTable('reservation_tables', {
    reservation_id: { type: 'uuid', notNull: true, references: 'reservations', onDelete: 'CASCADE' },
    table_id: { type: 'uuid', notNull: true, references: 'tables', onDelete: 'RESTRICT' },
  });
  pgm.addConstraint('reservation_tables', 'reservation_tables_pk', {
    primaryKey: ['reservation_id', 'table_id'],
  });
  // The query the locking transaction runs: "which active reservations currently occupy this
  // table?" — this index makes that a direct lookup instead of a scan.
  pgm.createIndex('reservation_tables', ['table_id']);
};

exports.down = (pgm) => {
  pgm.dropTable('reservation_tables');
  pgm.dropTable('reservations');
};
