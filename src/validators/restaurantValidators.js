const { z } = require('zod');
const { uuid, dateStr } = require('./common');

const listMenuQuerySchema = z.object({
  categoryId: uuid.optional(),
});

const dashboardListQuerySchema = z.object({
  date: dateStr.optional(),
});

module.exports = { listMenuQuerySchema, dashboardListQuerySchema };
