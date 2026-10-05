const { z } = require('zod');

// Shared primitive schemas so every validator file applies the same bounds (docs/TESTING.md's
// "invalid/malformed ids" and "invalid date" cases are caught here, structurally, for every
// endpoint that uses them — not re-implemented per controller).
const uuid = z.string().uuid();
const phone = z.string().trim().min(5, 'phone is too short').max(20, 'phone is too long');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be in YYYY-MM-DD format');
const timeStr = z.string().regex(/^\d{2}:\d{2}$/, 'must be in HH:mm format');

module.exports = { uuid, phone, dateStr, timeStr };
