# Development Log

## Current phase
Phase 6 complete (business services, unit-tested). Starting Phase 7 (reservation engine).

## Completed
- Phase 1: Repository inspection — repo was empty (README + .gitignore only), nothing to reuse.
- Phase 2: Architecture decided (Node/Express/plain-JS, raw `pg` + parameterized SQL, no ORM,
  zod validation, JWT staff auth, UUID PKs, cents-based pricing, idempotency keys, Postgres
  `SELECT ... FOR UPDATE` row-locking transaction for double-booking). Full docs written:
  PROJECT_OVERVIEW, ARCHITECTURE, DATABASE, API (skeleton), AI_TOOLS, AGENT_FLOW, SECURITY
  (threat model), ERROR_HANDLING, TESTING (strategy + checklist), DECISIONS, INTEGRATION,
  DEMO_SCENARIOS.
- Phase 3: `package.json`, `src/config/env.js` (fail-fast env validation via zod),
  `src/db/pool.js` (shared `pg` pool, `query`/`withTransaction` helpers), and 7
  `node-pg-migrate` migrations covering all 16 tables (the 14 from `DATABASE.md` plus
  `reservation_tables` and `pgmigrations` itself). Verified for real: ran `up` against a local
  Postgres 16, inspected the resulting schema (generated `time_range` column, constraints,
  triggers all present as designed), ran `down` 7 and back `up` cleanly, applied to both the dev
  and test databases. `npm audit --omit=dev` is clean (0 vulnerabilities) after pinning
  `bcrypt@^6` — see `SECURITY.md`.

- Phase 4: `src/db/seed.js` seeds "Himalayan Bites" — 1 restaurant (opening hours, combination
  seating enabled), 1 owner user (bcrypt-hashed password, logged to console for local dev only),
  6 tables (capacities 2/2/4/4/6/8), 5 menu categories, 17 realistic Nepali menu items (one
  deliberately `is_available: false` to exercise that path later). Idempotent — re-ran it twice
  against the dev database and row counts were identical both times.

- Phase 5: repository layer — `errors/AppError.js` (typed app error + notFound/validationError/
  forbidden/unauthorized/conflict factories) and 9 repository modules (restaurants, users,
  restaurant_users, tables, menu, customers, reservations, orders, conversation
  sessions/messages, ai_actions, audit_logs). Every tenant-owned lookup takes `restaurantId`
  explicitly and scopes the query by it — no bare-id lookups. `tableRepository.lockByIds` +
  `reservationRepository.findOverlappingTableIds` are the two primitives Phase 7/8's allocation
  service will compose into the actual locking transaction; the repository layer itself has no
  allocation logic, just the query primitives. Verified with an ad hoc smoke-test script (not
  committed — Phase 15 builds the real Jest suite) run against the seeded dev database: 18
  assertions covering tenant-scoped reads, idempotent `findOrCreate`, the `FOR UPDATE` lock +
  overlap check actually catching a just-created reservation, server-side order pricing, and
  session-state merge-patching — all passed.

- Phase 6: three pure business-logic services, deliberately kept DB-free so they're trivial to
  unit test: `openingHoursService` (restaurant-timezone-aware "is this date/time bookable" check
  and the candidate-time-slot generator `find_alternative_times` will use — built on `Intl`, no
  date library dependency needed), `stateTransitionService` (the exact reservation/order state
  machines from `AGENT_FLOW.md`, as `assertReservationTransition`/`assertOrderTransition`), and
  `pricingService.buildOrderLines` (the concrete code that makes "never trust a client-supplied
  price" true — it has no parameter a price could even be passed through). Added
  `INVALID_ORDER_TRANSITION` to the error catalog in `ERROR_HANDLING.md` (parallel to the
  reservation one). 28 unit tests across 3 suites, all passing, covering both the happy paths and
  the specific malicious/invalid cases from `TESTING.md` (negative quantity, unavailable item,
  unknown id, a smuggled `priceCents` field being silently ignored, every terminal-state
  transition rejected).

## Current task
Phase 7: the reservation engine (create/modify/cancel) wired through these services, plus the
table-allocation algorithm itself (exact fit → smallest suitable → allowed combination) that
Phase 6 deliberately left out since it needs the repository-layer locking primitives, not just
pure logic.

## Next task
Phase 8 concurrency hardening is really built alongside Phase 7 (the locking transaction IS the
allocation algorithm's safety net) — then Phase 9, the order engine.

## Known issues
- `reservation_tables` combination-seating (`allow_table_combination`) is schema-ready but the
  allocation algorithm implementing it lands in Phase 7/8, not before.
- Dev-dependency `braces` (via `jest`) has an open high-severity advisory; tracked in
  `SECURITY.md`, not in the production dependency tree.

## Important decisions
See `DECISIONS.md` for the full ADR log. Summary: no ORM, UUID PKs, cents pricing, Postgres
`SELECT ... FOR UPDATE` row-locking transaction for double-booking, idempotency via
`Idempotency-Key` + unique constraint, short-lived JWT with no refresh rotation (v1 scope).

## Definition of Done tracking
- [x] Architecture + docs
- [x] Database can be created from scratch
- [x] Migrations work (verified up/down/up against a real Postgres instance)
- [x] Seed data works (verified idempotent against a real Postgres instance)
- [ ] Backend starts successfully
- [ ] REST API works
- [ ] Reservations work
- [ ] Table allocation works
- [ ] Alternative times work
- [ ] Reservation modification works
- [ ] Cancellation works
- [ ] Orders work
- [ ] Menu availability works
- [ ] AI tools work
- [ ] AI cannot directly access the database
- [ ] Backend validates AI tool arguments
- [ ] Conversation/session state works
- [ ] AI actions are logged
- [ ] Partner integration is documented (first draft done — `INTEGRATION.md`; finalized Phase 16)
- [ ] Security tests pass
- [ ] Automated tests pass
- [ ] No secrets are committed
- [ ] Tenant isolation works
- [ ] SQL injection protection works
- [ ] Duplicate requests are handled
- [ ] Transactions are used where necessary
- [ ] Documentation matches actual implementation
- [ ] Fresh setup is documented
- [ ] A new developer can clone, configure `.env`, migrate/seed, start, and test from the README
