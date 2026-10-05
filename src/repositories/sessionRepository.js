const { pool } = require('../db/pool');

const mapSession = (row) => ({
  id: row.id,
  restaurantId: row.restaurant_id,
  customerPhone: row.customer_phone,
  channel: row.channel,
  state: row.state,
  status: row.status,
});

async function create(restaurantId, customerPhone, channel = 'voice', executor = pool) {
  const result = await executor.query(
    `INSERT INTO conversation_sessions (restaurant_id, customer_phone, channel)
     VALUES ($1, $2, $3)
     RETURNING id, restaurant_id, customer_phone, channel, state, status`,
    [restaurantId, customerPhone ?? null, channel]
  );
  return mapSession(result.rows[0]);
}

async function findById(id, executor = pool) {
  const result = await executor.query(
    `SELECT id, restaurant_id, customer_phone, channel, state, status
     FROM conversation_sessions
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

/**
 * Shallow JSONB merge via `||` — matches docs/AGENT_FLOW.md: a `PATCH { partySize: 6 }` updates
 * just that key and leaves `date`/`time`/etc. untouched, so the orchestrator never has to resend
 * the whole state to change one slot.
 */
async function patchState(id, partialState, executor = pool) {
  const result = await executor.query(
    `UPDATE conversation_sessions
     SET state = state || $2::jsonb
     WHERE id = $1
     RETURNING id, restaurant_id, customer_phone, channel, state, status`,
    [id, JSON.stringify(partialState)]
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

async function markEnded(id, status, executor = pool) {
  const result = await executor.query(
    `UPDATE conversation_sessions
     SET status = $2, ended_at = now()
     WHERE id = $1
     RETURNING id, restaurant_id, customer_phone, channel, state, status`,
    [id, status]
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

async function appendMessage(sessionId, role, content, executor = pool) {
  await executor.query(
    `INSERT INTO conversation_messages (session_id, role, content) VALUES ($1, $2, $3)`,
    [sessionId, role, content]
  );
}

/** Full transcript in chronological order — what the dashboard's "AI activity" view reads. */
async function listMessages(sessionId, executor = pool) {
  const result = await executor.query(
    `SELECT role, content, created_at FROM conversation_messages WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId]
  );
  return result.rows.map((row) => ({ role: row.role, content: row.content, createdAt: row.created_at }));
}

module.exports = { create, findById, patchState, markEnded, appendMessage, listMessages };
