const orderService = require('../services/orderService');
const { asyncHandler } = require('../middleware/asyncHandler');
const { validationError } = require('../errors/AppError');

function requireIdempotencyKey(req) {
  const key = req.get('Idempotency-Key');
  if (!key) throw validationError('An Idempotency-Key header is required for this request.');
  return key;
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw validationError('items must be a non-empty array of { menuItemId, quantity }.');
  }
  for (const item of items) {
    if (typeof item?.menuItemId !== 'string' || !Number.isInteger(item?.quantity)) {
      throw validationError('Each item requires a menuItemId (string) and quantity (integer).');
    }
  }
  return items.map(({ menuItemId, quantity }) => ({ menuItemId, quantity }));
}

const createOrder = asyncHandler(async (req, res) => {
  const { customer, items, reservationId } = req.body ?? {};
  if (!customer?.phone) {
    throw validationError('customer.phone is required.');
  }
  const idempotencyKey = requireIdempotencyKey(req);

  const order = await orderService.createOrder(req.restaurant, {
    customerPhone: customer.phone,
    customerName: customer.name,
    items: validateItems(items),
    reservationId,
    idempotencyKey,
  });
  res.status(201).json({ success: true, order });
});

const getOrder = asyncHandler(async (req, res) => {
  const order = await orderService.getOrder(req.restaurant, req.params.orderId);
  res.json({ success: true, order });
});

const modifyOrder = asyncHandler(async (req, res) => {
  const order = await orderService.modifyOrder(req.restaurant, req.params.orderId, validateItems(req.body?.items));
  res.json({ success: true, order });
});

const cancelOrder = asyncHandler(async (req, res) => {
  const order = await orderService.cancelOrder(req.restaurant, req.params.orderId);
  res.json({ success: true, order });
});

module.exports = { createOrder, getOrder, modifyOrder, cancelOrder };
