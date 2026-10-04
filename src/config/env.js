const { z } = require('zod');
require('dotenv').config();

// Fail fast at boot if a required secret/config value is missing, rather than failing later
// inside a request handler with a confusing downstream error.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be set to a long random value'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  AI_SESSION_SECRET: z.string().min(16, 'AI_SESSION_SECRET must be set to a long random value'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Intentionally not using the shared logger here: this runs before the app (and the logger's
  // config) exists, and a misconfigured environment is exactly the case where we must not depend
  // on anything else having started correctly.
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

module.exports = parsed.data;
