const { AppError, notFound, validationError } = require('../errors/AppError');

/**
 * Turns `[{ menuItemId, quantity }, ...]` plus the actual menu item rows fetched from the
 * database into priced order lines + totals. This is the concrete enforcement of "never trust a
 * client/AI-supplied price" (docs/DECISIONS.md): the only price this function ever uses is
 * `menuItem.priceCents` from the database row the caller already looked up — there is no
 * parameter here for a caller to pass a price in, so there's no code path that could use one even
 * by mistake.
 *
 * @param {Map<string, {id, name, priceCents, isAvailable}>} menuItemsById - keyed by menu item id
 * @param {Array<{menuItemId: string, quantity: number}>} requestedItems
 */
function buildOrderLines(menuItemsById, requestedItems) {
  if (!requestedItems.length) {
    throw validationError('An order must have at least one item.');
  }

  let subtotalCents = 0;
  const lines = requestedItems.map(({ menuItemId, quantity }) => {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw validationError(`Quantity must be a positive integer (got ${quantity}).`);
    }
    const menuItem = menuItemsById.get(menuItemId);
    if (!menuItem) {
      throw notFound('Menu item');
    }
    if (!menuItem.isAvailable) {
      throw new AppError('MENU_ITEM_UNAVAILABLE', `${menuItem.name} is not currently available.`, 422);
    }
    const lineTotalCents = menuItem.priceCents * quantity;
    subtotalCents += lineTotalCents;
    return {
      menuItemId: menuItem.id,
      name: menuItem.name,
      quantity,
      unitPriceCents: menuItem.priceCents,
      lineTotalCents,
    };
  });

  // v1 has no tax/service charge layered on top — total equals subtotal, but kept as a separate
  // field (rather than reusing subtotalCents for both) so adding one later is a one-line change
  // here instead of a schema/response-shape change.
  return { lines, subtotalCents, totalCents: subtotalCents };
}

module.exports = { buildOrderLines };
