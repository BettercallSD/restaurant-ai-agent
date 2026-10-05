const tableRepository = require('../repositories/tableRepository');
const menuRepository = require('../repositories/menuRepository');
const { asyncHandler } = require('../middleware/asyncHandler');

const getRestaurant = asyncHandler(async (req, res) => {
  const { restaurant } = req;
  res.json({
    success: true,
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      phone: restaurant.phone,
      address: restaurant.address,
      openingHours: restaurant.openingHours,
      timezone: restaurant.timezone,
    },
  });
});

const listTables = asyncHandler(async (req, res) => {
  const tables = await tableRepository.listActive(req.restaurant.id);
  res.json({ success: true, tables });
});

const listMenu = asyncHandler(async (req, res) => {
  const { categoryId } = req.query;
  const categories = await menuRepository.listCategories(req.restaurant.id);
  const items = await menuRepository.listItems(req.restaurant.id, { categoryId });
  const itemsByCategory = new Map(categories.map((c) => [c.id, []]));
  for (const item of items) {
    itemsByCategory.get(item.categoryId)?.push({
      id: item.id,
      name: item.name,
      description: item.description,
      priceCents: item.priceCents,
      isAvailable: item.isAvailable,
    });
  }
  res.json({
    success: true,
    categories: categories.map((c) => ({ id: c.id, name: c.name, items: itemsByCategory.get(c.id) ?? [] })),
  });
});

module.exports = { getRestaurant, listTables, listMenu };
