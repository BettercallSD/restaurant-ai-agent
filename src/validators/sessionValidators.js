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

module.exports = { createSessionSchema, patchSessionStateSchema, appendMessageSchema };
