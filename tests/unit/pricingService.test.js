const { buildOrderLines } = require('../../src/services/pricingService');

const menuItemsById = new Map([
  ['momo', { id: 'momo', name: 'Chicken Momo', priceCents: 25000, isAvailable: true }],
  ['chowmein', { id: 'chowmein', name: 'Chicken Chowmein', priceCents: 28000, isAvailable: true }],
  ['seasonal', { id: 'seasonal', name: 'Seasonal Special', priceCents: 30000, isAvailable: false }],
]);

describe('buildOrderLines', () => {
  test('computes line totals and subtotal/total from DB prices, ignoring any caller price', () => {
    const result = buildOrderLines(menuItemsById, [
      { menuItemId: 'momo', quantity: 2 },
      { menuItemId: 'chowmein', quantity: 1 },
    ]);
    expect(result.lines).toEqual([
      { menuItemId: 'momo', name: 'Chicken Momo', quantity: 2, unitPriceCents: 25000, lineTotalCents: 50000 },
      { menuItemId: 'chowmein', name: 'Chicken Chowmein', quantity: 1, unitPriceCents: 28000, lineTotalCents: 28000 },
    ]);
    expect(result.subtotalCents).toBe(78000);
    expect(result.totalCents).toBe(78000);
  });

  test('rejects an empty order', () => {
    expect(() => buildOrderLines(menuItemsById, [])).toThrow(/at least one item/);
  });

  test('rejects a negative quantity', () => {
    expect(() => buildOrderLines(menuItemsById, [{ menuItemId: 'momo', quantity: -1 }])).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' })
    );
  });

  test('rejects a zero quantity', () => {
    expect(() => buildOrderLines(menuItemsById, [{ menuItemId: 'momo', quantity: 0 }])).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' })
    );
  });

  test('rejects a menu item id that was not found', () => {
    expect(() => buildOrderLines(menuItemsById, [{ menuItemId: 'does-not-exist', quantity: 1 }])).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' })
    );
  });

  test('rejects an unavailable menu item', () => {
    expect(() => buildOrderLines(menuItemsById, [{ menuItemId: 'seasonal', quantity: 1 }])).toThrow(
      expect.objectContaining({ code: 'MENU_ITEM_UNAVAILABLE' })
    );
  });

  test('a caller-supplied price field is ignored entirely (there is no such parameter)', () => {
    // Simulates a malicious/buggy caller trying to smuggle a price through extra fields.
    const result = buildOrderLines(menuItemsById, [{ menuItemId: 'momo', quantity: 1, priceCents: 1 }]);
    expect(result.lines[0].unitPriceCents).toBe(25000);
  });
});
