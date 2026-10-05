const { z } = require('zod');
const { phone } = require('./common');

const createSessionSchema = z.object({
  customerPhone: phone.optional(),
  channel: z.enum(['voice', 'web', 'test']).optional(),
});

const patchSessionStateSchema = z.object({
  // The session's state blob is intentionally opaque to the backend (docs/AGENT_FLOW.md) — the
  // orchestrator owns what fields it contains, so this only enforces "it's a plain object", not
  // specific field names or types.
  state: z.record(z.string(), z.any()),
});

const appendMessageSchema = z.object({
  role: z.enum(['customer', 'ai', 'system']),
  content: z.string().trim().min(1).max(4000),
});

// Defaults to COMPLETED: the common case for calling this endpoint at all is a clean hangup
// signal (docs/INTEGRATION.md) — a partner with a reason to think the call was abandoned passes
// that explicitly.
const endSessionSchema = z.object({
  status: z.enum(['COMPLETED', 'ABANDONED']).default('COMPLETED'),
});

module.exports = { createSessionSchema, patchSessionStateSchema, appendMessageSchema, endSessionSchema };
