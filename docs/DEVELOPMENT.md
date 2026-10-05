# Development Log

## Current phase
Phase 9 complete (order engine, integration-tested). Starting Phase 10 (REST API).

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

- Phases 7+8: `src/services/tableAllocationService.js` (the exact-fit → smallest-suitable →
  allowed-combination algorithm, as a read-only `checkAvailability` for advisory checks and a
  locking `allocateWithLock` for actual bookings — see docs/DATABASE.md's concurrency section) and
  `src/services/reservationService.js` (create/get/modify/cancel, idempotency-key handling,
  alternative-time search on failure). Added `src/utils/dateTime.js` (restaurant-local calendar
  arithmetic, no date library) and `src/config/constants.js`. Found and fixed a real bug along the
  way: `pg` parses `DATE`/`TIME` columns into JS `Date` objects by default, which silently broke
  every string-based comparison the whole system relies on (idempotency replay comparison, opening
  hours) — fixed with a type-parser override in `src/db/pool.js`, caught by the idempotency
  integration test failing unexpectedly rather than by inspection.
- Added `tests/integration/reservationEngine.test.js` (13 tests against a real Postgres test
  database) alongside the Phase 6 unit tests — 39 tests total, all passing. The concurrency test
  genuinely matters here: an early version of it raced two parties of 6 at a fresh slot and both
  "succeeded", which looked like a double-booking bug but was actually a test design flaw (the
  restaurant had enough separate tables + allowed combination to legitimately seat both). Fixed by
  first deliberately filling every table except one, so the two concurrent requests actually
  contend for the same resource — then exactly one correctly won and the other got
  `RESERVATION_UNAVAILABLE`.

- Phase 9: `src/services/orderService.js` — create/get/modify/cancel, reusing `pricingService`
  (Phase 6) for all pricing and `orderRepository` (Phase 5) for persistence. No locking
  transaction needed here (unlike reservations) — pricing is a pure read with no concurrency
  hazard, since nothing about two people ordering the same menu item at once is a race; only table
  *availability* is a scarce, lockable resource. Idempotency and the "unavailable item"/"unknown
  item id"/"negative quantity" rejections all go through the exact same `buildOrderLines` function
  Phase 6 already unit-tested — no new pricing logic was written here, only orchestration around
  it. A reservationId passed to `create_order` is tenant-verified (must resolve under this
  restaurant) before the order links to it.
- Added `tests/integration/orderEngine.test.js` (12 tests). Combined with Phases 6-8, the suite is
  now 51 tests, all passing, with zero new bugs found this round — the groundwork from Phases 5-8
  (tenant-scoped repositories, the shared `AppError` factories, the `pg` DATE/TIME fix) carried
  over cleanly.

## Current task
Phase 10: the REST API (Express routes/controllers) exposing everything built so far.

## Next task
Phase 11: validation (zod schemas), authentication/authorization (staff JWT + AI session tokens),
centralized error handling, and rate limiting — wired into the Phase 10 routes.

## Known issues
- Combination-seating caps at 3 tables (`MAX_COMBINED_TABLES`) and searches by brute-force
  combination enumeration — fine at hackathon scale (a handful of tables per restaurant), would
  need a smarter search for a restaurant with dozens of tables.
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
- [ ] Backend starts successfully (no HTTP server yet — Phase 10)
- [ ] REST API works (Phase 10)
- [x] Reservations work (service layer; HTTP layer is Phase 10)
- [x] Table allocation works (exact fit → smallest suitable → combination, integration-tested)
- [x] Alternative times work
- [x] Reservation modification works
- [x] Cancellation works (including idempotent re-cancellation)
- [x] Orders work (service layer; HTTP layer is Phase 10)
- [x] Menu availability works (unavailable items rejected at order time)
- [ ] AI tools work
- [ ] AI cannot directly access the database
- [ ] Backend validates AI tool arguments
- [ ] Conversation/session state works
- [ ] AI actions are logged
- [ ] Partner integration is documented (first draft done — `INTEGRATION.md`; finalized Phase 16)
- [ ] Security tests pass (full pass is Phase 17; reservation-layer cases already covered)
- [x] Automated tests pass (51/51 — `npm test`; more added each phase)
- [x] No secrets are committed
- [x] Tenant isolation works (reservation layer; full HTTP-layer coverage is Phase 11)
- [ ] SQL injection protection works (true at every query written so far; full sweep Phase 17)
- [x] Duplicate requests are handled (idempotency keys, reservations)
- [x] Transactions are used where necessary (reservation create/modify locking transaction)
- [ ] Documentation matches actual implementation
- [ ] Fresh setup is documented
- [ ] A new developer can clone, configure `.env`, migrate/seed, start, and test from the README
