const menuRepository = require('../repositories/menuRepository');
const { notFound } = require('../errors/AppError');

/**
 * Shared by the plain REST `GET .../menu` endpoint and the `get_menu` AI tool — identical logic,
 * previously duplicated in both controllers. Consolidating it here is what let the Phase 17 audit
 * fix a real gap in one place instead of two: `categoryId`, if given, must actually belong to this
 * restaurant (docs/AI_TOOLS.md always documented this as a 404 case) — `menuRepository
 * .categoryExists` existed since Phase 5 but nothing ever called it, so a category id from a
 * different restaurant (or a nonexistent one) silently returned every category with empty items
 * instead of a clean 404.
 */
async function listMenu(restaurant, categoryId) {
  if (categoryId) {
    const exists = await menuRepository.categoryExists(restaurant.id, categoryId);
    if (!exists) throw notFound('Menu category');
  }

  const categories = await menuRepository.listCategories(restaurant.id);
  const items = await menuRepository.listItems(restaurant.id, { categoryId });
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

  return categories.map((c) => ({ id: c.id, name: c.name, items: itemsByCategory.get(c.id) ?? [] }));
}

module.exports = { listMenu };
