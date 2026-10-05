/* eslint-disable camelcase */

exports.shorthands = undefined;

// docs/AI_TOOLS.md's get_restaurant_info always documented an `address` field, but the original
// restaurants table (migration 1767225601000) never actually had the column - caught while
// wiring up the Phase 10 restaurant controller. Fixing the schema rather than dropping the
// documented field, since "what's your address" is a realistic thing a caller asks the AI.
exports.up = (pgm) => {
  pgm.addColumn('restaurants', {
    address: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('restaurants', 'address');
};
