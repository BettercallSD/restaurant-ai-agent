const express = require('express');
const routes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const { notFound } = require('./errors/AppError');

const app = express();

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
