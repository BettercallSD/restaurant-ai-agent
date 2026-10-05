const { z } = require('zod');
const { phone, dateStr, timeStr } = require('./common');

const createReservationSchema = z.object({
  customer: z.object({
    phone,
    name: z.string().trim().min(1).max(120).optional(),
  }),
  date: dateStr,
  time: timeStr,
  partySize: z.number().int().min(1).max(50),
  specialRequests: z.string().trim().max(500).optional(),
});

const modifyReservationSchema = z
  .object({
    date: dateStr.optional(),
    time: timeStr.optional(),
    partySize: z.number().int().min(1).max(50).optional(),
  })
  .refine((data) => data.date !== undefined || data.time !== undefined || data.partySize !== undefined, {
    message: 'At least one of date, time, or partySize must be provided.',
  });

module.exports = { createReservationSchema, modifyReservationSchema };
