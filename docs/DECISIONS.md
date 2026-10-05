# Decisions

Architecture Decision Record. Newest first.

## Hand-written function-calling schemas, not a generated ones

**Decision**: `src/tools/schemas.js` hand-writes the 13 OpenAI-style function-calling JSON Schemas
for the partner's orchestrator, rather than generating them from the `zod` validators in
`src/validators/aiToolValidators.js` via a library like `zod-to-json-schema`.

**Why**: 13 small, stable schemas don't justify a new dependency. The real enforcement is still the
backend's own zod validation — if `schemas.js` ever drifts from a validator, the worst case is the
AI sends something the backend rejects with `VALIDATION_ERROR` (annoying, recoverable), never a
security or correctness gap, since the zod schema is what actually runs. Documented as a drift risk
to watch, not eliminated — acceptable for 13 schemas that rarely change.

## AI-facing tool responses are narrower than the equivalent REST responses

**Decision**: `get_reservation`'s tool output returns table *labels* ("T5"), never the raw table
UUIDs the plain REST API's equivalent response includes.

**Why**: "never send unnecessary data to the AI" is a stated principle, not just a security one —
the AI only ever needs to say a table number out loud, never reason about or forward an internal
id. Rather than reuse `reservationService.formatReservation`'s output verbatim for both the
dashboard-facing REST endpoint and the AI tool, `aiToolController.js` reshapes it per tool,
intentionally keeping the two response shapes allowed to diverge.

## Session creation is public; everything else requires auth

**Decision**: `POST /restaurants/:id/sessions` has no authentication — it's reachable with no
token at all, scoped only by the restaurant id in the URL. Every other session route (`GET`,
`PATCH`, `POST .../messages`), and every reservation/order route, requires an `Authorization:
Bearer` token (a staff JWT or the AI session token this endpoint issues).

**Why**: this endpoint's entire job is to issue the credential (`aiToken`) everything downstream
checks — there's no token to present yet when a call first comes in, the same way a login endpoint
can't itself require being logged in. The real security boundary here is the assumption that only
the partner's own trusted telephony/orchestration backend calls this endpoint server-to-server,
not the untrusted AI or a public client. A production deployment would gate it behind a
restaurant-specific API key issued to that integration; building a whole second API-key auth
system was judged out of scope for the hackathon on top of staff JWT + AI session tokens, which
`SECURITY.md` already commits to as the two auth mechanisms. `sessionCreateLimiter` (a stricter
rate limit than other endpoints) is the compensating control in the meantime.

## Two JWT secrets, not one

**Decision**: staff JWTs are signed with `JWT_SECRET`; AI session tokens are signed with a
separate `AI_SESSION_SECRET`.

**Why**: the two tokens mean very different things — "this is an authenticated dashboard user" vs
"this is the orchestrator for one specific phone call, scoped to one restaurant and (for session
routes) one session id". Using one secret for both would mean a bug that accepts one token type
somewhere it shouldn't could cross those boundaries. With separate secrets, `authenticate.js` can
even use *which* secret verifies a token as the signal for which kind of actor it is.

## No ORM — raw `pg` with parameterized queries

**Decision**: Use `pg` directly with hand-written parameterized SQL in the repository layer, no
Prisma/Sequelize/Knex.

**Why**: The brief's non-negotiable is "parameterized SQL queries or a suitable query
builder/ORM" — both are acceptable, but raw parameterized SQL makes the actual safety mechanism
(`$1, $2, ...` placeholders) visible and explainable line-by-line, which matters for the teaching
requirement and for being able to defend every query during the hackathon judging. It also avoids
pulling in a second ORM's conventions into a project that already borrows nothing from the
sibling Funtasy League repo (which uses Prisma) — keeping the two projects' stacks independent
avoids confusing the two codebases' idioms.

## UUID primary keys, not serial integers

**Decision**: every table's PK is `uuid default gen_random_uuid()`.

**Why**: sequential integer IDs are enumerable — an attacker (or a curious AI tool argument) can
try `reservationId: 124` after seeing `123`. UUIDs close that off for free, which matters more
here than in a typical CRUD app because tool arguments are *untrusted AI output*, not just
untrusted HTTP input.

## Prices in integer cents, snapshotted at order time

**Decision**: `menu_items.price_cents` is the only source of truth; `order_items.unit_price_cents`
copies it at order-creation time rather than joining live.

**Why**: floats lose cents over enough additions; snapshotting avoids a later menu price edit
silently rewriting historical order totals. This is also the concrete enforcement of "never trust
a client/AI-supplied price" — the order service reads the price itself and ignores any price field
if one is even present in the request.

## Row-level locking (`SELECT ... FOR UPDATE`) for double-booking, not a declarative exclusion constraint

**Decision**: reservation creation/modification runs inside a transaction that locks the specific
candidate `tables` rows (`FOR UPDATE`), re-checks for overlapping active reservations on those
tables while holding the locks, then inserts — rather than a declarative
`EXCLUDE USING gist (table_id WITH =, time_range WITH &&)` constraint.

**Why considered first**: a GiST exclusion constraint is the more "set it and forget it" option
and was the original plan — but it needs a single row carrying both `table_id` and `time_range`
together. Once table combination (`allow_table_combination`) requires a `reservation_tables` join
table (a reservation can occupy more than one table), neither `time_range` nor `status` lives on
that join row, so the constraint would need those columns denormalized onto
`reservation_tables` and kept in sync via a trigger on every possible mutation of the parent
reservation (date, time, duration, status). That's real ongoing complexity and a second source of
truth that can drift.

**Why row locking instead**: `SELECT ... FOR UPDATE` on the exact table row(s) being considered
serializes any two transactions that touch the same table — the second one blocks until the first
commits, at which point its re-check correctly sees the new reservation and reports
`RESERVATION_UNAVAILABLE`. This is standard, explainable PostgreSQL locking (see
`DATABASE.md`'s concurrency section), works identically for one table or several, and needs no
denormalization. The tradeoff accepted: correctness now depends on every reservation-writing code
path going through the same locking service method — there's exactly one such path
(`reservationService`), so this is enforced by having no other way to write a reservation, not by
reviewer discipline.

## JavaScript, not TypeScript

**Decision**: plain Node.js/Express/JS, per the brief's preferred stack and to minimize build
tooling for a hackathon timeline.

## Idempotency via a client-supplied key + unique constraint, not a generic middleware cache

**Decision**: `Idempotency-Key` header, stored per-restaurant-unique on `reservations`/`orders`;
a repeated key returns the original row. A mismatched body on a reused key is rejected
(`IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY`) rather than silently returning stale data for a
genuinely different request.

**Why considered and rejected**: a generic "cache every POST response for N minutes keyed by
request hash" middleware would also cover GETs that don't need it and adds a cache-invalidation
surface; scoping idempotency to the two actually-dangerous mutations (create reservation, create
order) is simpler and matches exactly what the brief calls out as priority.

## Short-lived JWT with no refresh rotation (v1)

**Decision**: staff JWT access tokens are short-lived (documented expiry in `SECURITY.md`'s auth
section) with no refresh-token flow yet.

**Why**: the dashboard is the partner's surface and isn't the thing being judged on security depth
in this hackathon; a refresh-token rotation system is real work that doesn't change whether the
*agentic* core (reservation/order/AI-tool path) is secure. Documented here explicitly as a known
v1 simplification rather than an oversight — see Definition of Done tracking in `DEVELOPMENT.md`.
