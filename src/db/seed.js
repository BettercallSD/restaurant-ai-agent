/**
 * Seeds one realistic restaurant ("Himalayan Bites") for local development and demos.
 * Safe to re-run: every insert is keyed off a unique column with ON CONFLICT DO NOTHING, so
 * running `npm run seed` twice does not create duplicate rows.
 *
 * This script talks to the database directly (not through the repository/service layers built
 * in later phases) because seeding is a one-off bootstrap operation, not a business action — see
 * docs/DECISIONS.md if that choice needs revisiting later.
 */
const bcrypt = require('bcrypt');
const { pool, withTransaction } = require('./pool');

// price_cents stores the smallest unit of NPR (paisa, 1 NPR = 100 paisa) — kept consistent with
// the generic cents-based pricing convention in docs/DATABASE.md even though real Nepali menus
// are quoted in whole rupees. This helper makes that conversion explicit at every call site.
const rupees = (amount) => Math.round(amount * 100);

const OPENING_HOURS = {
  sun: { open: '11:00', close: '21:30' },
  mon: { open: '11:00', close: '21:30' },
  tue: { open: '11:00', close: '21:30' },
  wed: { open: '11:00', close: '21:30' },
  thu: { open: '11:00', close: '21:30' },
  fri: { open: '11:00', close: '22:00' },
  sat: { open: '11:00', close: '22:00' },
};

const TABLES = [
  { label: 'T1', capacity: 2 },
  { label: 'T2', capacity: 2 },
  { label: 'T3', capacity: 4 },
  { label: 'T4', capacity: 4 },
  { label: 'T5', capacity: 6 },
  { label: 'T6', capacity: 8 },
];

const MENU = [
  {
    category: 'Momo',
    items: [
      { name: 'Chicken Momo (10pc)', description: 'Steamed chicken dumplings with achar.', price: 250 },
      { name: 'Veg Momo (10pc)', description: 'Steamed vegetable dumplings with achar.', price: 200 },
      { name: 'Jhol Momo', description: 'Momo in a spiced sesame-tomato soup.', price: 230, unavailable: true },
      { name: 'Kothey Momo', description: 'Pan-fried and steamed, chicken filling.', price: 270 },
    ],
  },
  {
    category: 'Main Course',
    items: [
      { name: 'Dal Bhat Tarkari', description: 'Lentil soup, rice, seasonal vegetable curry, achar.', price: 350 },
      { name: 'Chicken Sekuwa', description: 'Skewered grilled chicken, Nepali spices.', price: 420 },
      { name: 'Newari Khaja Set', description: 'Beaten rice, chhoyla, bara, and sides.', price: 480 },
      { name: 'Aloo Tama', description: 'Potato and bamboo shoot curry.', price: 230 },
    ],
  },
  {
    category: 'Noodles & Soup',
    items: [
      { name: 'Chicken Chowmein', description: 'Stir-fried noodles with chicken and vegetables.', price: 280 },
      { name: 'Veg Thukpa', description: 'Tibetan-style noodle soup with vegetables.', price: 260 },
      { name: 'Gundruk Soup', description: 'Fermented leafy green soup.', price: 180 },
    ],
  },
  {
    category: 'Beverages',
    items: [
      { name: 'Masala Chiya', description: 'Spiced Nepali milk tea.', price: 60 },
      { name: 'Mustang Coffee', description: 'Butter coffee with local spices.', price: 150 },
      { name: 'Lassi', description: 'Sweet yogurt drink.', price: 150 },
      { name: 'Coke', description: '300ml bottle.', price: 100 },
    ],
  },
  {
    category: 'Desserts',
    items: [
      { name: 'Yomari', description: 'Steamed rice-flour dumpling with molasses filling.', price: 150 },
      { name: 'Sel Roti', description: 'Traditional sweet ring-shaped rice bread.', price: 80 },
    ],
  },
];

async function seed() {
  await withTransaction(async (client) => {
    const restaurantResult = await client.query(
      `INSERT INTO restaurants (name, slug, phone, address, timezone, opening_hours, allow_table_combination, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         phone = EXCLUDED.phone,
         address = EXCLUDED.address,
         timezone = EXCLUDED.timezone,
         opening_hours = EXCLUDED.opening_hours,
         allow_table_combination = EXCLUDED.allow_table_combination,
         is_active = EXCLUDED.is_active
       RETURNING id`,
      [
        'Himalayan Bites',
        'himalayan-bites',
        '+977-1-4123456',
        'Durbar Marg, Kathmandu 44600, Nepal',
        'Asia/Kathmandu',
        OPENING_HOURS,
        true,
        true,
      ]
    );
    const restaurantId = restaurantResult.rows[0].id;

    const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, name, is_platform_admin)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      ['owner@himalayanbites.test', passwordHash, 'Himalayan Bites Owner']
    );
    const userId = userResult.rows[0].id;

    await client.query(
      `INSERT INTO restaurant_users (restaurant_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (restaurant_id, user_id) DO NOTHING`,
      [restaurantId, userId]
    );

    for (const table of TABLES) {
      await client.query(
        `INSERT INTO tables (restaurant_id, label, capacity)
         SELECT $1, $2, $3
         WHERE NOT EXISTS (
           SELECT 1 FROM tables WHERE restaurant_id = $1 AND label = $2
         )`,
        [restaurantId, table.label, table.capacity]
      );
    }

    let categoryOrder = 0;
    for (const category of MENU) {
      categoryOrder += 1;
      const categoryResult = await client.query(
        `INSERT INTO menu_categories (restaurant_id, name, display_order)
         SELECT $1, $2, $3
         WHERE NOT EXISTS (
           SELECT 1 FROM menu_categories WHERE restaurant_id = $1 AND name = $2
         )
         RETURNING id`,
        [restaurantId, category.category, categoryOrder]
      );
      const categoryId =
        categoryResult.rows[0]?.id ??
        (
          await client.query(
            `SELECT id FROM menu_categories WHERE restaurant_id = $1 AND name = $2`,
            [restaurantId, category.category]
          )
        ).rows[0].id;

      for (const item of category.items) {
        await client.query(
          `INSERT INTO menu_items (restaurant_id, category_id, name, description, price_cents, is_available)
           SELECT $1, $2, $3, $4, $5, $6
           WHERE NOT EXISTS (
             SELECT 1 FROM menu_items WHERE restaurant_id = $1 AND name = $3
           )`,
          [restaurantId, categoryId, item.name, item.description, rupees(item.price), !item.unavailable]
        );
      }
    }
  });

  console.log('Seed complete: Himalayan Bites (slug: himalayan-bites)');
  console.log('Owner login: owner@himalayanbites.test / ChangeMe123! (change before any real deploy)');
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
