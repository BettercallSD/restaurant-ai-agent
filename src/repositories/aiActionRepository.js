const { pool } = require('../db/pool');

/**
 * `sanitizedInput`/`sanitizedResult` must already be the validated-args / structured-response
 * objects a tool actually used and returned — never raw headers, tokens, or full database rows.
 * Sanitization happens at the call site (the AI tool controller), not here, so this stays a plain
 * insert with no judgment calls about what's safe to store.
 */
async function record(
  { sessionId, restaurantId, toolName, status, durationMs, sanitizedInput, sanitizedResult },
  executor = pool
) {
  await executor.query(
    `INSERT INTO ai_actions
       (session_id, restaurant_id, tool_name, status, duration_ms, sanitized_input, sanitized_result)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      sessionId ?? null,
      restaurantId,
      toolName,
      status,
      durationMs ?? null,
      sanitizedInput ? JSON.stringify(sanitizedInput) : null,
      sanitizedResult ? JSON.stringify(sanitizedResult) : null,
    ]
  );
}

async function listForSession(sessionId, executor = pool) {
  const result = await executor.query(
    `SELECT id, tool_name, status, duration_ms, sanitized_input, sanitized_result, created_at
     FROM ai_actions
     WHERE session_id = $1
     ORDER BY created_at ASC`,
    [sessionId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    toolName: row.tool_name,
    status: row.status,
    durationMs: row.duration_ms,
    sanitizedInput: row.sanitized_input,
    sanitizedResult: row.sanitized_result,
    createdAt: row.created_at,
  }));
}

module.exports = { record, listForSession };
