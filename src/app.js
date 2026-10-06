const express = require('express');
const pinoHttp = require('pino-http');
const routes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const { notFound } = require('./errors/AppError');
const { logger } = require('./config/logger');

const app = express();

// Found during the Phase 17 audit: Express sets this by default, handing out the exact framework
// in every response header for free — no reason to make that easier than it needs to be.
app.disable('x-powered-by');

// Structured, request-scoped logging (docs/SECURITY.md "unsafe logs"): every request gets a log
// line with method/path/status/duration and a request id, and `req.log` is available to any
// downstream handler (the error handler uses it) as a logger already bound to that request id —
// no need to thread request context through manually. Request *bodies* are never logged by
// pino-http's defaults, which is what keeps customer phone numbers/names out of logs without
// needing a redaction rule for every possible field name.
app.use(pinoHttp({ logger }));

// 32kb is generous for these endpoints — every request body here is a small structured object
// (a reservation, an order's line items, a session patch), never a file upload.
app.use(express.json({ limit: '32kb' }));

app.get('/health', (req, res) => res.json({ success: true, status: 'ok' }));

app.use('/api/v1', routes);

// Any route that doesn't match becomes a clean 404 through the same error envelope, instead of
// Express's default HTML error page.
app.use((req, res, next) => next(notFound('Route')));

app.use(errorHandler);

module.exports = app;
