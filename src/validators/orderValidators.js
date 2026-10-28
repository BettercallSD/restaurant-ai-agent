const { z } = require('zod');
const { uuid, phone } = require('./common');

const orderItemSchema = z.object({
  menuItemId: uuid,
  quantity: z.number().int().min(1).max(20),
});

const MAX_ORDER_LINES = 50;
const orderItems = z
  .array(orderItemSchema)
  .min(1, 'An order must have at least one item.')
  .max(MAX_ORDER_LINES, `An order can have at most ${MAX_ORDER_LINES} different items.`);

const createOrderSchema = z.object({
  customer: z.object({
    phone,
    name: z.string().trim().min(1).max(120).optional(),
  }),
  items: orderItems,
  reservationId: uuid.optional(),
});

const modifyOrderSchema = z.object({
  items: orderItems,
});

module.exports = { orderItemSchema, orderItems, createOrderSchema, modifyOrderSchema };
