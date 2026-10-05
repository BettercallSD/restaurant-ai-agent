const { z } = require('zod');
const { uuid, phone, dateStr, timeStr } = require('./common');
const { orderItemSchema } = require('./orderValidators');

const partySize = z.number().int().min(1).max(50);
// The AI has no HTTP-header concept the way a REST client does, so idempotencyKey is a normal
// body field for tool calls (docs/AI_TOOLS.md), unlike the plain REST API's Idempotency-Key header.
const idempotencyKey = z.string().min(1).max(200);

const emptySchema = z.object({});
const getMenuToolSchema = z.object({ categoryId: uuid.optional() });
const checkItemAvailabilitySchema = z.object({ menuItemId: uuid });
const checkTableAvailabilitySchema = z.object({ date: dateStr, time: timeStr, partySize });
const findAlternativeTimesSchema = z.object({ date: dateStr, partySize, preferredTime: timeStr.optional() });

const createReservationToolSchema = z.object({
  customerName: z.string().trim().min(1).max(120).optional(),
  customerPhone: phone,
  date: dateStr,
  time: timeStr,
  partySize,
  specialRequests: z.string().trim().max(500).optional(),
  idempotencyKey,
});

const getReservationToolSchema = z
  .object({ reservationId: uuid.optional(), customerPhone: phone.optional() })
  .refine((d) => d.reservationId || d.customerPhone, {
    message: 'reservationId or customerPhone is required.',
  });

const modifyReservationToolSchema = z
  .object({
    reservationId: uuid,
    date: dateStr.optional(),
    time: timeStr.optional(),
    partySize: partySize.optional(),
  })
  .refine((d) => d.date !== undefined || d.time !== undefined || d.partySize !== undefined, {
    message: 'At least one of date, time, or partySize must be provided.',
  });

const cancelReservationToolSchema = z.object({ reservationId: uuid });

const createOrderToolSchema = z.object({
  customerPhone: phone,
  items: z.array(orderItemSchema).min(1, 'An order must have at least one item.'),
  reservationId: uuid.optional(),
  idempotencyKey,
});

const modifyOrderToolSchema = z.object({
  orderId: uuid,
  items: z.array(orderItemSchema).min(1, 'An order must have at least one item.'),
});

const cancelOrderToolSchema = z.object({ orderId: uuid });

const transferToHumanSchema = z.object({ reason: z.string().trim().min(1).max(500) });

module.exports = {
  emptySchema,
  getMenuToolSchema,
  checkItemAvailabilitySchema,
  checkTableAvailabilitySchema,
  findAlternativeTimesSchema,
  createReservationToolSchema,
  getReservationToolSchema,
  modifyReservationToolSchema,
  cancelReservationToolSchema,
  createOrderToolSchema,
  modifyOrderToolSchema,
  cancelOrderToolSchema,
  transferToHumanSchema,
};
