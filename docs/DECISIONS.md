# Decisions

Architecture Decision Record. Newest first.

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

## PostgreSQL exclusion constraint for double-booking, not just application-level locking

**Decision**: `EXCLUDE USING gist` on `(table_id, time_range)` for active reservations, in addition
to (not instead of) an application-level availability check.

**Why**: an application-only check-then-insert has a race window between the `SELECT` and the
`INSERT` — two concurrent requests can both see "available". Wrapping the insert in a transaction
with `SELECT ... FOR UPDATE` on the table row would work too, but requires remembering to take the
lock on every code path that can create a reservation; the exclusion constraint makes the
guarantee database-enforced and impossible to bypass by a future code path that forgets to lock.
The application check stays because it lets the service return a friendly `RESERVATION_UNAVAILABLE`
+ alternatives response instead of surfacing a raw constraint-violation error to the caller.

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
