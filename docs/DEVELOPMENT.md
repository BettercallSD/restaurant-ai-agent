# Development Log

## Current phase
Phase 12 complete (AI tool layer — the full agentic check→book→confirm flow is live and
integration-tested). Starting Phase 13 (conversation/session state polish).

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

- Phase 11: `src/utils/jwt.js` (two separate secrets — staff vs. AI session, see `DECISIONS.md`),
  `src/services/authService.js` + `authController.js` + `POST /auth/login` (bcrypt compare,
  identical error for wrong-password vs. unknown-email so login can't enumerate accounts),
  `src/middleware/authenticate.js` (resolves `req.actor` from either token type) and
  `authorizeActor.js` (the actual tenant-authorization check — staff via `restaurant_users` role
  lookup, AI via its `restaurantId` claim; mismatch is 404, not 403, per the IDOR note in
  `ERROR_HANDLING.md`). `sessionController.js` now issues the `aiToken` on session creation and
  additionally scopes session sub-resource routes to that exact session id, not just the
  restaurant — an AI token for one phone call cannot read a different call's session.
  `src/middleware/rateLimiters.js` (auth/session-creation/mutation limits).
  `src/middleware/validateParams.js` (UUID route-param validation — closes a gap where a malformed
  id would otherwise reach Postgres directly and surface as a raw 500) and real zod schemas in
  `src/validators/` replacing every ad hoc presence check from Phase 10.
  **The Phase 10 security gap is now closed** — every route that touches customer data requires
  authentication, and the authorization check is real (not a stand-in).
- Rewrote `tests/integration/api.test.js` almost entirely, since nearly every endpoint now needs a
  real token — added staff login, AI session token issuance/scoping, cross-tenant and
  cross-session access attempts, a malformed-id-is-400-not-500 check, and a rate-limiting test that
  genuinely fires requests until a 429 comes back. One bug found along the way, in the *test*, not
  the backend: the test helper's fake phone numbers were longer than the zod schema's own 20-char
  limit, so the HTTP-layer tests failed validation the service-layer tests never would have caught
  (they bypass HTTP entirely). Fixed the helper, not the limit. Full suite: 79/79 passing.

- Phase 12: `src/validators/aiToolValidators.js` (one zod schema per tool, reusing `orderItemSchema`
  and the shared `common.js` primitives rather than redefining them), `src/middleware/
  requireAiActor.js` (rejects a staff JWT with 403 — tool endpoints are AI-only; resolves the
  restaurant from the token's claim, not a URL param, since these routes have no `:restaurantId` at
  all — nothing for a prompt-injected "pretend this is restaurant X" to even target),
  `src/controllers/aiToolController.js` (13 thin handlers behind one `tool()` wrapper that logs
  every call — success or failure — to `ai_actions` with duration, sanitized input, and sanitized
  result), `src/routes/aiToolRoutes.js`, and `src/tools/schemas.js` (the OpenAI-style
  function-calling JSON Schemas promised to the partner back in Phase 2's `INTEGRATION.md` but
  never actually written until now — caught while updating that doc for this phase).
  AI-facing responses are narrower than the equivalent REST ones on purpose: `get_reservation`
  returns table *labels* ("T5"), never the raw table ids the dashboard-facing REST endpoint
  includes — keeps to "never send unnecessary data to the AI."
  Found and fixed a real Phase-7-era gap along the way: `reservationService.getReservation` (and
  the idempotency-replay path in `createReservation`) only ever fetched bare table *ids* for a
  reservation, never looked up their labels/capacity — invisible until a test actually asserted on
  `tables[].label`, since `create`/`modify` happen to return the allocation result directly and
  never hit that code path. Fixed by adding `tableRepository.findByIds`.
  Added `tests/integration/aiTools.test.js` (18 tests) covering the full agentic flow end to end:
  check availability → book → confirm, staff-JWT rejection, cross-tenant/cross-session 404s, the
  "never claim success the backend didn't confirm" guarantee (fill every table, then assert the
  next booking attempt gets `RESERVATION_UNAVAILABLE` with alternatives, not a false 200), DB-priced
  orders ignoring a smuggled price, and `transfer_to_human`. Verified live against a running server
  too. Full suite: 93/93 passing.

## Current task
Phase 13: conversation/session state polish beyond what Phases 10-12 already built (session
create/patch/messages and the AI token lifecycle already work end to end) — mainly slot
normalization helpers an orchestrator can lean on, if any are still missing once Phase 12's
real usage patterns are accounted for.

## Next task
Phase 14: formalize AI action logging beyond "every tool call writes a row" (already true since
Phase 12) — likely a `GET` endpoint for the dashboard to read a session's `ai_actions` trace, plus
the structured `pino` logging with redaction that's been deferred since Phase 10.

## Known issues
- `POST /restaurants/:id/sessions` is intentionally unauthenticated (it's the credential-issuing
  endpoint — see `DECISIONS.md`); the compensating control is its own stricter rate limit. A
  production deployment would gate it behind a restaurant-specific API key for the telephony
  integration.
- Rate limiting uses express-rate-limit's in-memory store — correct for a single-instance
  deployment, but would under-count across multiple instances. A shared store (Redis) would be
  needed before horizontally scaling.
- No dashboard staff-write endpoints yet (table/menu-item create/edit, reservation list view) —
  the auth mechanism they need now exists, they're just not built.
- Combination-seating caps at 3 tables (`MAX_COMBINED_TABLES`) and searches by brute-force
  combination enumeration — fine at hackathon scale (a handful of tables per restaurant), would
  need a smarter search for a restaurant with dozens of tables.
- Dev-dependency `braces` (via `jest`) has an open high-severity advisory; tracked in
  `SECURITY.md`, not in the production dependency tree.
- Logging is currently just `console.error` for unexpected failures — structured, redaction-aware
  logging (`pino`) is Phase 14, not done yet.

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
- [x] AI tools work (all 13 tools from `AI_TOOLS.md`, live over HTTP, integration-tested including
      the full check→book→confirm agentic flow)
- [x] AI cannot directly access the database (true by construction — `aiToolController.js` only
      ever calls the same services everything else uses)
- [x] Backend validates AI tool arguments (zod schemas per tool, verified with malformed/missing
      arguments never reaching the service layer)
- [x] Conversation/session state works (create/patch-merge/append-message, over HTTP, with real
      session-scoped auth)
- [x] AI actions are logged (every tool call, success or failure, writes to `ai_actions` with
      duration/sanitized input/sanitized result — verified live and in
      `tests/integration/aiTools.test.js`; a dashboard-facing read endpoint for this is Phase 14)
- [ ] Partner integration is documented (first draft done — `INTEGRATION.md`; `src/tools/schemas.js`
      now gives the function-calling schemas it promised; finalized further in Phase 16)
- [ ] Security tests pass (full pass is Phase 17; auth/authz/reservation/order/HTTP-layer/AI-tool
      cases already covered, including live SQL injection/XSS/mass-assignment/rate-limit checks
      against a running server)
- [x] Automated tests pass (93/93 — `npm test`; more added each phase)
- [x] No secrets are committed
- [x] Tenant isolation works (real authentication + authorization, not just data-layer scoping —
      verified with cross-tenant *and* cross-session access attempts, live and in the test suite)
- [x] SQL injection protection works (every query in the codebase is parameterized; verified live
      with real injection payloads against the running server, not just by inspection)
- [x] Duplicate requests are handled (idempotency keys, reservations and orders)
- [x] Transactions are used where necessary (reservation locking transaction; order create/modify)
- [x] Documentation matches actual implementation (API.md, DATABASE.md, INTEGRATION.md updated
      this phase to match what was actually built, including two real gaps caught and fixed along
      the way — see above)
- [x] Fresh setup is documented (README.md has the real, verified commands)
- [x] A new developer can clone, configure `.env`, migrate/seed, start, and test from the README
