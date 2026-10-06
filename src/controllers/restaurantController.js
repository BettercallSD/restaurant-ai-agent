const tableRepository = require('../repositories/tableRepository');
const menuService = require('../services/menuService');
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
  const categories = await menuService.listMenu(req.restaurant, req.query.categoryId);
  res.json({ success: true, categories });
});

module.exports = { getRestaurant, listTables, listMenu };
