# Development Log

## Current phase
Phase 10 complete (REST API, integration-tested over real HTTP). Starting Phase 11 (validation,
auth, rate limiting).

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

- Phase 10: `src/app.js`/`src/server.js` (Express app, `/health`, centralized `errorHandler`
  matching the `ERROR_HANDLING.md` envelope exactly, a catch-all 404), and routes/controllers for
  restaurants/menu/tables (read-only), reservations, orders, and sessions, all nested under
  `/restaurants/:restaurantId/...`. Controllers whitelist fields explicitly (no `req.body` spread)
  — mass-assignment attempts (a client sending `status`/`restaurantId` in the body) were tested
  live and confirmed ignored. Also fixed a real schema/doc gap caught while wiring the restaurant
  controller: `AI_TOOLS.md` had always documented a `get_restaurant_info` `address` field that the
  `restaurants` table never actually had — added via a new migration rather than dropping the
  field, since "what's your address" is a realistic AI query; also fixed the seed script's
  `ON CONFLICT` clause, which previously only refreshed `name` on re-seed, silently leaving every
  other field (including the new `address`) stale on an existing database.
  **Known gap, by design and tracked below**: `src/middleware/resolveRestaurant.js` resolves the
  restaurant purely from the URL with no authorization check yet — Phase 11 adds the actual
  tenant-authorization boundary. Don't treat this API as secure multi-tenant until then.
- Added `tests/integration/api.test.js` (15 Supertest tests against the real Express app + test
  database) covering status codes, the error envelope, routing, and — run live against the actual
  HTTP server, not just the test suite — SQL injection, XSS, and mass-assignment payloads, all
  handled safely. Full suite: 66/66 passing.

## Current task
Phase 11: validation (zod schemas replacing the current minimal presence checks), authentication/
authorization (staff JWT + AI session tokens, and `resolveRestaurant` upgraded to actually check
them), centralized rate limiting, and the dashboard-only endpoints deferred from Phase 10 (table/
menu-item writes, reservation list view).

## Next task
Phase 12: the AI tool layer (`/ai/tools/*` endpoints per `AI_TOOLS.md`), which depends on Phase
11's AI session tokens existing first.

## Known issues
- **No authentication/authorization yet.** Every `/api/v1/restaurants/:restaurantId/*` route
  trusts the URL param with no check — this is the single biggest open item and Phase 11's entire
  focus. Do not demo this as tenant-isolated until that lands.
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
- [x] Backend starts successfully (`npm run dev` / `npm start`, verified with a live `curl`)
- [x] REST API works (verified live over HTTP, not just the test suite)
- [x] Reservations work (full HTTP path)
- [x] Table allocation works (exact fit → smallest suitable → combination, integration-tested)
- [x] Alternative times work
- [x] Reservation modification works
- [x] Cancellation works (including idempotent re-cancellation)
- [x] Orders work (full HTTP path)
- [x] Menu availability works (unavailable items rejected at order time)
- [ ] AI tools work (Phase 12)
- [x] AI cannot directly access the database (true by construction — no code path gives the AI
      anything but a tool-layer HTTP endpoint; formalized further once Phase 12's tools exist)
- [ ] Backend validates AI tool arguments (Phase 11 zod schemas / Phase 12 tool endpoints)
- [x] Conversation/session state works (create/patch-merge/append-message, over HTTP)
- [ ] AI actions are logged
- [ ] Partner integration is documented (first draft done — `INTEGRATION.md`; finalized Phase 16)
- [ ] Security tests pass (full pass is Phase 17; reservation/order/HTTP-layer cases already
      covered, including live SQL injection/XSS/mass-assignment payloads against a running server)
- [x] Automated tests pass (66/66 — `npm test`; more added each phase)
- [x] No secrets are committed
- [ ] Tenant isolation works (data-layer isolation proven; the *authorization* half — verifying
      the caller may act on this restaurant at all — is Phase 11, see Known Issues)
- [x] SQL injection protection works (every query in the codebase is parameterized; verified live
      with real injection payloads against the running server, not just by inspection)
- [x] Duplicate requests are handled (idempotency keys, reservations and orders)
- [x] Transactions are used where necessary (reservation locking transaction; order create/modify)
- [x] Documentation matches actual implementation (API.md, DATABASE.md, INTEGRATION.md updated
      this phase to match what was actually built, including two real gaps caught and fixed along
      the way — see above)
- [x] Fresh setup is documented (README.md has the real, verified commands)
- [ ] A new developer can clone, configure `.env`, migrate/seed, start, and test from the README
      (true for everyone except Phase 11's not-yet-existing auth step)
