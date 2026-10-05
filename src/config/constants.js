// Shared business constants that aren't admin-configurable per restaurant (those — opening hours,
// allow_table_combination — live on the `restaurants` row itself; see docs/DATABASE.md).
module.exports = {
  DEFAULT_RESERVATION_DURATION_MINUTES: 90,
  ALTERNATIVE_TIME_SEARCH_INTERVAL_MINUTES: 30,
  MAX_COMBINED_TABLES: 3,
};
