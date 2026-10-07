# Testing

Status: suite built in Phase 15, extended through Phase 17, and complete as of Phase 18's
end-to-end pass (103/103 automated tests, plus a live full-system run — see below).

## Strategy

- **Unit tests** for pure business logic that doesn't need a database: table allocation selection
  algorithm, pricing math, state-transition validation, alternative-time search.
- **Integration tests** (Jest + Supertest) against a real disposable PostgreSQL database
  (`DATABASE_URL_TEST`), migrated fresh before the suite runs. Each test runs inside a transaction
  that's rolled back afterward, so tests don't leak state into each other.
- **AI tool integration tests** specifically exercise the full `tool endpoint → service →
  repository → database` path, asserting the exact structured JSON shape documented in
  `AI_TOOLS.md` — these are what prove the AI genuinely can't bypass business logic, not just that
  the HTTP route exists.
- **End-to-end (Phase 18)**: all of the above runs each piece in isolation (a fresh transaction per
  test, each engine tested on its own). Phase 18 added one more layer on top: a single continuous
  run of every `DEMO_SCENARIOS.md` scenario, in order, as one AI session against one live,
  freshly-migrated-and-seeded server — the same way a real phone call would actually exercise the
  system, state carried from one tool call to the next, rather than each case starting from a
  clean slate. This is what actually proved the full check→book→modify→cancel lifecycle, the
  menu→order flow, and every Phase 17 security fix hold up identically when run together instead
  of independently. Not committed as a Jest suite (it drives a running server over real HTTP and
  is meant to be re-run by hand before a demo, not on every `npm test`) — see
  `DEVELOPMENT.md`'s Phase 18 entry for what it covered and found.

## Required cases (tracked here, checked off as implemented)

- [x] Valid reservation (covered many times over since Phase 7 — checking off an earlier oversight)
- [x] Unavailable table → alternatives returned (`tests/integration/reservationEngine.test.js`)
- [x] Invalid party size (0 — DB check constraint). Negative/absurdly-large covered at the Phase
      11 validator layer once zod schemas exist; the service layer already rejects 0 via Postgres.
- [x] Invalid date (past date). Malformed string covered at the Phase 11 validator layer (zod).
- [x] Duplicate reservation (same idempotency key, same body) → same result, no second row
- [x] Duplicate reservation (same idempotency key, different body) → rejected
- [x] Cancellation (valid transition, and idempotent re-cancellation)
- [x] Invalid reservation state transition (modifying/re-transitioning a CANCELLED reservation)
- [x] Modification (valid, re-checks availability)
- [x] Valid order (priced from the database, a smuggled client-side price field ignored)
- [x] Unavailable menu item → rejected
- [x] Invalid quantity (0, negative, over-max) — unit-tested in Phase 6 and enforced by the Phase
      11 zod schema (1-20) at the HTTP layer
- [x] Unauthorized request (no/invalid/garbage/expired token) → 401, verified live and in
      `tests/integration/api.test.js`
- [x] Cross-restaurant access attempt → 404, both at the service layer and the full HTTP layer (a
      valid staff token for restaurant A used against restaurant B's resource; a valid AI session
      token for one session used to read a *different* session's data — `authorizeActor.js` /
      `sessionController.js`)
- [x] SQL injection attempt in a text field (`' OR '1'='1`, a `DROP TABLE` payload in a name field)
      → treated as literal string data, no behavior change — verified live against a running
      server, not just asserted
- [x] XSS payload in a text field (`<script>alert(1)</script>`) → stored/returned as literal text,
      verified it comes back verbatim as a JSON string value
- [x] Path traversal / malformed-id attempt in an id-like field (`../../etc/passwd`, `not-a-uuid`)
      → fails zod UUID validation, 400 (not a raw Postgres error) — both route params
      (`validateUuidParam`) and body fields (`menuItemId`, `reservationId`)
- [x] Negative quantity on an order (unavailable item, unknown item id, and idempotency
      replay/mismatch all covered in `tests/integration/orderEngine.test.js`)
- [x] Invalid/malformed ids (non-UUID strings) — see path traversal row above
- [x] Unexpected extra fields in a request body (mass-assignment attempt, e.g. a client trying to
      set `status` or `restaurantId` directly) → silently stripped by zod, verified live
- [x] The same idempotency key racing itself (two concurrent identical creates — both reservations
      and orders) → exactly one row survives, and **both** concurrent calls get the same success
      response, not one success and one raw database error. This was a real bug, found with an
      actual reproduction script, not written speculatively: fixed in both services by catching the
      unique-constraint violation and recovering — see `DECISIONS.md` and
      `tests/integration/{reservationEngine,orderEngine}.test.js`.
- [x] Invalid AI tool arguments (wrong types, missing required fields) → `VALIDATION_ERROR`, no
      service/repository code reached — `tests/integration/aiTools.test.js`
- [x] A staff JWT against an AI tool endpoint is rejected (403) — tool endpoints are AI-only
- [x] AI tool authorization/tenant isolation — a reservation id for a different restaurant 404s
      through the tool layer the same as through the plain REST API
- [x] AI never gets a success response for an action the backend didn't actually confirm — proven
      by the overflow-booking test in `aiTools.test.js` (every table deliberately filled first,
      then `create_reservation` asserted to return 409 with alternatives, never a false 200)
- [x] Concurrent reservation attempt for the same table/slot → exactly one succeeds, the other
      gets `RESERVATION_UNAVAILABLE`. Verified with a genuine `Promise.allSettled` race against a
      real Postgres connection pool (not mocked) in
      `tests/integration/reservationEngine.test.js` — two parties of 8 racing for the one
      remaining table after every other table is deliberately filled first.

## Manual verification checklist (independent, by hand)

A third layer on top of the automated suite and the Phase 18 scripted end-to-end run: a fresh
clone, set up and walked through manually by hand, end to end, as a sanity check that an outside
developer following only the README actually gets a working system — not just that the commands
in `DEVELOPMENT.md`'s phase log happen to work in the environment that wrote them.

- [x] **Project setup** — installed Node dependencies, created `.env` from `.env.example`, set up
      PostgreSQL, created both databases (`DATABASE_URL` and `DATABASE_URL_TEST`), ran migrations,
      seeded sample restaurant data.
- [x] **Server start** — API running at `localhost:3000`; `GET /health` confirmed.
- [x] **Restaurant APIs** (public, no auth) — restaurant info, menu, tables all returned correctly.
- [x] **Staff login** — logged in as the restaurant owner, received a JWT; confirmed protected
      endpoints reject an expired token (the specific case `TESTING.md`'s required-cases list
      above already tracks, independently re-confirmed by hand here).
- [x] **Reservations** — created, retrieved, modified, cancelled; duplicate creation under the same
      idempotency key correctly prevented (no second row).
- [x] **Orders** — created with menu items, total computed correctly from DB prices (not a
      client-supplied value), retrieved, modified, cancelled.

**Not yet covered by this manual pass** (flagged rather than assumed fine just because the
automated suite covers it):
- The idempotency-key check in the *other* direction — same key, a **different** body — correctly
  rejected with a 409, rather than only verifying the same-key/same-body replay case above. This
  is the subtler of the two halves: a real concurrency bug was found and fixed here in Phase 15
  (see `DECISIONS.md`), so it's worth confirming by hand too, not just trusting the automated test.
- The **AI tool endpoints** (`POST /api/v1/ai/tools/*`) — a separate auth path (AI session token
  from `POST /restaurants/:id/sessions`, no staff JWT) and a narrower response shape than the
  plain REST endpoints exercised above. This is the surface the voice/orchestration layer will
  actually call, so it's the natural next manual pass once the above is confirmed.

## Commands

```bash
npm test                # migrates + resets + seeds the test DB, then runs the full suite against it
npm run test:unit       # business-logic unit tests only, no DB required
npm run migrate:test    # apply migrations to the test database
npm run reset:test      # truncate dynamic tables (reservations, orders, sessions, ...) in the test DB
npm run seed:test       # seed Himalayan Bites into the test database
```

`npm test` is self-contained — it migrates, resets, and seeds `DATABASE_URL_TEST` before running
Jest, so a fresh checkout only needs that env var set to a real Postgres database, empty or not.
The reset step exists because tests pick a random future date per run to avoid colliding with a
*previous* run's own leftover rows — that works within reasonable bounds, but across enough
repeated runs a random collision became observable in practice (caught during Phase 15, not
theorized about). Resetting the dynamic tables before every run removes the root cause instead of
just making collisions rarer. `src/db/resetTestData.js` refuses to run outside `NODE_ENV=test`.

(Exact script names finalized when `package.json` lands in Phase 3; this file is updated then.)
