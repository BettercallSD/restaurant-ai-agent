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
  pgm.createTable('conversation_sessions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    restaurant_id: { type: 'uuid', notNull: true, references: 'restaurants', onDelete: 'CASCADE' },
    customer_phone: { type: 'text' },
    channel: { type: 'text', notNull: true, default: 'voice' },
    // Slot-filling state (intent, date, time, partySize, ...) — see docs/AGENT_FLOW.md.
    // Treated as an opaque, merge-patched blob; the backend doesn't interpret its fields.
    state: { type: 'jsonb', notNull: true, default: '{}' },
    status: {
      type: 'text',
      notNull: true,
      default: 'ACTIVE',
      check: "status IN ('ACTIVE','COMPLETED','ABANDONED')",
    },
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    ended_at: { type: 'timestamptz' },
    ...timestampColumns(pgm),
  });
  pgm.createIndex('conversation_sessions', ['restaurant_id', 'status']);
  attachUpdatedAtTrigger(pgm, 'conversation_sessions');

  pgm.createTable('conversation_messages', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    session_id: { type: 'uuid', notNull: true, references: 'conversation_sessions', onDelete: 'CASCADE' },
    role: { type: 'text', notNull: true, check: "role IN ('customer','ai','system')" },
    content: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('conversation_messages', ['session_id', 'created_at']);

  pgm.createTable('ai_actions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    session_id: { type: 'uuid', references: 'conversation_sessions', onDelete: 'SET NULL' },
    restaurant_id: { type: 'uuid', notNull: true, references: 'restaurants', onDelete: 'CASCADE' },
    tool_name: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, check: "status IN ('SUCCESS','FAILURE')" },
    duration_ms: { type: 'integer' },
    // Validated tool arguments / structured result only — never raw headers, tokens, or full
    // database rows. See docs/SECURITY.md.
    sanitized_input: { type: 'jsonb' },
    sanitized_result: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('ai_actions', ['restaurant_id', 'created_at']);
  pgm.createIndex('ai_actions', ['session_id']);

  pgm.createTable('audit_logs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    restaurant_id: { type: 'uuid', references: 'restaurants', onDelete: 'CASCADE' },
    actor_type: { type: 'text', notNull: true, check: "actor_type IN ('user','ai','system')" },
    actor_id: { type: 'text' },
    action: { type: 'text', notNull: true },
    resource_type: { type: 'text' },
    resource_id: { type: 'text' },
    metadata: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('audit_logs', ['restaurant_id', 'created_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('audit_logs');
  pgm.dropTable('ai_actions');
  pgm.dropTable('conversation_messages');
  pgm.dropTable('conversation_sessions');
};
