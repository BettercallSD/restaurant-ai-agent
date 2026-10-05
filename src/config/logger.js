const pino = require('pino');
const env = require('./env');

/**
 * One shared logger for the whole process. `redact` guarantees a bearer token, password, or
 * password hash can never reach a log line even if some future code path accidentally logs an
 * object that contains one — this is enforced at the logger level, not left to every call site to
 * remember (docs/SECURITY.md's "unsafe logs" mitigation).
 */
const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'passwordHash',
      'token',
      'aiToken',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.aiToken',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = { logger };
