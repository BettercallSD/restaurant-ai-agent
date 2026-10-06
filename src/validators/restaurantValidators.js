const { z } = require('zod');
const { uuid } = require('./common');

const listMenuQuerySchema = z.object({
  categoryId: uuid.optional(),
});

module.exports = { listMenuQuerySchema };
