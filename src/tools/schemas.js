/**
 * OpenAI-style function-calling JSON Schema definitions for the partner's LLM orchestration layer
 * (docs/INTEGRATION.md). Hand-written rather than generated from the zod validators
 * (`src/validators/aiToolValidators.js`) — 13 small, stable schemas don't justify adding a
 * zod-to-json-schema dependency, but they're kept deliberately in lockstep with those validators:
 * if a field here doesn't match, the backend's own zod schema is the one that actually enforces
 * correctness, so a drift here only ever produces a `VALIDATION_ERROR` the AI has to recover from,
 * never a security or correctness gap.
 *
 * Each entry's `name` is also the URL segment: `POST /api/v1/ai/tools/<name with underscores
 * replaced by hyphens>`.
 */

const tools = [
  {
    name: 'get_restaurant_info',
    description: "Get the restaurant's name, phone, address, opening hours, and timezone.",
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_menu',
    description: 'Get the menu, optionally filtered to one category.',
    parameters: {
      type: 'object',
      properties: { categoryId: { type: 'string', format: 'uuid' } },
      required: [],
    },
  },
  {
    name: 'check_item_availability',
    description: 'Check whether a specific menu item is currently available, and its price.',
    parameters: {
      type: 'object',
      properties: { menuItemId: { type: 'string', format: 'uuid' } },
      required: ['menuItemId'],
    },
  },
  {
    name: 'check_table_availability',
    description: 'Check whether a table (or combination of tables) is available for a party at a given date/time.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:mm, 24-hour' },
        partySize: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['date', 'time', 'partySize'],
    },
  },
  {
    name: 'find_alternative_times',
    description: 'List bookable times for a date/party size, closest to a preferred time if given.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        partySize: { type: 'integer', minimum: 1, maximum: 50 },
        preferredTime: { type: 'string', description: 'HH:mm, 24-hour' },
      },
      required: ['date', 'partySize'],
    },
  },
  {
    name: 'create_reservation',
    description:
      'Book a table. Only call this after check_table_availability confirmed a slot, or after the customer accepted an alternative time. Returns success:false with alternatives if the slot is no longer available.',
    parameters: {
      type: 'object',
      properties: {
        customerName: { type: 'string' },
        customerPhone: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:mm, 24-hour' },
        partySize: { type: 'integer', minimum: 1, maximum: 50 },
        specialRequests: { type: 'string' },
        idempotencyKey: {
          type: 'string',
          description: 'A new random UUID per booking attempt; resend the SAME value if retrying a dropped request.',
        },
      },
      required: ['customerPhone', 'date', 'time', 'partySize', 'idempotencyKey'],
    },
  },
  {
    name: 'get_reservation',
    description: "Look up a reservation by id, or the customer's most recent active one by phone.",
    parameters: {
      type: 'object',
      properties: {
        reservationId: { type: 'string', format: 'uuid' },
        customerPhone: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'modify_reservation',
    description: 'Change the date, time, and/or party size of an existing reservation.',
    parameters: {
      type: 'object',
      properties: {
        reservationId: { type: 'string', format: 'uuid' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:mm, 24-hour' },
        partySize: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['reservationId'],
    },
  },
  {
    name: 'cancel_reservation',
    description: 'Cancel a reservation. Safe to call even if it was already cancelled.',
    parameters: {
      type: 'object',
      properties: { reservationId: { type: 'string', format: 'uuid' } },
      required: ['reservationId'],
    },
  },
  {
    name: 'create_order',
    description: 'Place a food order. Prices always come from the restaurant\'s own menu, never from this call.',
    parameters: {
      type: 'object',
      properties: {
        customerPhone: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              menuItemId: { type: 'string', format: 'uuid' },
              quantity: { type: 'integer', minimum: 1, maximum: 20 },
            },
            required: ['menuItemId', 'quantity'],
          },
          minItems: 1,
        },
        reservationId: { type: 'string', format: 'uuid' },
        idempotencyKey: { type: 'string', description: 'A new random UUID per order attempt.' },
      },
      required: ['customerPhone', 'items', 'idempotencyKey'],
    },
  },
  {
    name: 'modify_order',
    description: 'Replace an order\'s line items (only while it is still PENDING).',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', format: 'uuid' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              menuItemId: { type: 'string', format: 'uuid' },
              quantity: { type: 'integer', minimum: 1, maximum: 20 },
            },
            required: ['menuItemId', 'quantity'],
          },
          minItems: 1,
        },
      },
      required: ['orderId', 'items'],
    },
  },
  {
    name: 'cancel_order',
    description: 'Cancel an order (only while PENDING or CONFIRMED).',
    parameters: {
      type: 'object',
      properties: { orderId: { type: 'string', format: 'uuid' } },
      required: ['orderId'],
    },
  },
  {
    name: 'transfer_to_human',
    description: 'Hand off to restaurant staff for anything outside what these tools can do.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    },
  },
];

module.exports = { tools };
