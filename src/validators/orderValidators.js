const { z } = require('zod');
const { uuid, phone } = require('./common');

const orderItemSchema = z.object({
  menuItemId: uuid,
  quantity: z.number().int().min(1).max(20),
});

const createOrderSchema = z.object({
  customer: z.object({
    phone,
    name: z.string().trim().min(1).max(120).optional(),
  }),
  items: z.array(orderItemSchema).min(1, 'An order must have at least one item.'),
  reservationId: uuid.optional(),
});

const modifyOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1, 'An order must have at least one item.'),
});

module.exports = { createOrderSchema, modifyOrderSchema };
