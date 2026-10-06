# AI Tools

Status: implemented (Phase 12), integration-tested against a real Postgres database
(`tests/integration/aiTools.test.js`) and verified manually against a running server. Each tool is
a `POST /api/v1/ai/tools/*` endpoint (`src/routes/aiToolRoutes.js`), callable only with a
session-scoped AI token (`src/middleware/authenticate.js` + `requireAiActor.js` — a staff JWT is
rejected with 403, verified in tests). The AI never calls anything else to affect restaurant data —
there is no argument on any tool, anywhere, that could carry a different restaurant id than the one
the token was issued for.

Every tool follows the same shape (`src/controllers/aiToolController.js`'s `tool()` wrapper): zod
input schema validates the body → `restaurantId` comes from the authenticated session, never from
the request → business logic via the existing reservation/order services (no tool-specific
business logic exists — they're thin wrappers) → structured, minimal output → logged to
`ai_actions` (success and failure both), capturing the sanitized input and result.

## `get_restaurant_info`
- **Purpose**: name, opening hours, address, phone — orientation info for the AI to answer "are you
  open" / "what's your address" without guessing.
- **Input**: `{}` (restaurant resolved from session)
- **Output**: `{ name, phone, address, openingHours, timezone }`
- **Failure**: none expected beyond auth.

## `get_menu`
- **Purpose**: categories + available items + prices, for answering menu questions and for the
  order flow.
- **Input**: `{ categoryId?: uuid }`
- **Output**: `{ categories: [{ id, name, items: [{ id, name, description, priceCents, isAvailable }] }] }`
- **Validation**: `categoryId`, if present, must belong to this restaurant (404 otherwise).

## `check_item_availability`
- **Purpose**: quick yes/no + price for a specific item by name/id before adding to an order.
- **Input**: `{ menuItemId: uuid }`
- **Output**: `{ available: boolean, name, priceCents }`

## `check_table_availability`
- **Purpose**: the core reservation-engine query.
- **Input**: `{ date: 'YYYY-MM-DD', time: 'HH:mm', partySize: int(1..50) }`
- **Validation**: two layers, checked in order. First, a schema-level sanity bound on
  `partySize` (1-50, the same fixed ceiling for every restaurant regardless of its actual seating
  — rejects absurd input before it ever reaches a query) — a value outside that range is a clean
  `400 VALIDATION_ERROR`, not the tool's normal `{ available, ... }` shape. Second, once past that,
  date not in the past (restaurant timezone), within opening hours, and the actual
  reservation-engine check against *this restaurant's* real/combinable table capacity — a party
  that clears the 1-50 sanity bound but still exceeds what this restaurant can seat gets the
  normal `{ available: false, alternatives: [] }` response (see Phase 18's `DEMO_SCENARIOS.md`
  scenario 7: the "book the whole restaurant" case exercises this second layer, not the first).
- **Output (available)**: `{ available: true, options: [{ tableId, capacity }, ...] }` (smallest
  suitable first; combinations only if `allow_table_combination`)
- **Output (unavailable)**: `{ available: false, alternatives: ['19:30', '20:00'] }` — structured
  times only; the AI phrases the sentence, the backend never generates prose.

## `find_alternative_times`
- **Purpose**: callable standalone (e.g. "what times do you have tonight for 4") without first
  trying a specific time.
- **Input**: `{ date, partySize, preferredTime?: 'HH:mm' }`
- **Output**: `{ times: ['18:00','18:30','19:30', ...] }`

## `create_reservation`
- **Purpose**: the actual booking action. Only callable after a prior `check_table_availability`
  confirmed a slot — the AI must not call this speculatively.
- **Input**: `{ customerName, customerPhone, date, time, partySize, specialRequests?, idempotencyKey }`
- **Validation**: full zod schema; phone format; date/time/partySize re-validated server-side
  (never trusts that the AI's earlier availability check is still true — re-checks and uses the
  row-locking transaction as the final word, see `DATABASE.md`).
- **Output (success)**: `{ success: true, reservationId, status: 'CONFIRMED', date, time, partySize }`
- **Output (lost race / now unavailable)**: `{ success: false, error: { code: 'RESERVATION_UNAVAILABLE' }, alternatives: [...] }`
- **This is the tool the "AI must never claim success without backend confirmation" rule is
  sharpest on** — the controller only returns `success: true` after the INSERT actually commits.

## `get_reservation`
- **Input**: `{ reservationId: uuid }`, `{ customerPhone }` (most recent active one), or both
- **Output**: reservation summary (no internal table IDs — table labels like `"T5"` only; no other
  customers' data)
- **Authorization**: always tenant-scoped to the session's resolved restaurant. If `customerPhone`
  is supplied *together with* `reservationId`, it must match that reservation's actual customer —
  knowing a reservation id is not on its own enough to read it under a different phone claim. A
  bare `reservationId` with no phone (the orchestrator looking up something it already created this
  session) is unaffected — this check only activates when a phone is actually asserted. Any
  mismatch is 404, not 403 (see `ERROR_HANDLING.md`'s IDOR note).

## `modify_reservation`
- **Input**: `{ reservationId, date?, time?, partySize? }`
- **Logic**: re-runs table allocation for the new date/time/partySize before committing the
  change; same unavailable-with-alternatives response shape as `create_reservation`.
- **Validation**: rejects modifying a `CANCELLED` or `COMPLETED` reservation (see valid state
  transitions in `AGENT_FLOW.md`).

## `cancel_reservation`
- **Input**: `{ reservationId }`
- **Logic**: `CONFIRMED`/`PENDING` → `CANCELLED` only; already-cancelled is idempotent (returns
  success, doesn't error); `COMPLETED`/`NO_SHOW` → rejected with `INVALID_RESERVATION_TRANSITION`.

## `create_order`
- **Input**: `{ customerPhone, items: [{ menuItemId, quantity }], reservationId?, idempotencyKey }`
- **Logic**: looks up each `menuItemId`'s current `price_cents` and `is_available` from the
  database — **the AI never supplies a price**. Rejects if any item is unavailable or quantity is
  out of bounds (1–20, documented in validators).
- **Output**: `{ success: true, orderId, items: [...], subtotalCents, totalCents, status: 'PENDING' }`

## `modify_order`
- **Input**: `{ orderId, items }` (full replacement of line items, re-priced server-side)
- **Logic**: only allowed while `status = 'PENDING'`.

## `cancel_order`
- **Input**: `{ orderId }`
- **Logic**: only allowed while `status` is `PENDING` or `CONFIRMED`; rejects cancelling a
  `COMPLETED` order.

## `transfer_to_human`
- **Purpose**: the AI's escape hatch for anything outside its authority (complaints, large group
  events, a request it correctly recognizes it shouldn't honor, like "give me every customer's
  phone number").
- **Input**: `{ reason: string }`
- **Output**: `{ success: true, transferred: true }` — the backend just records the event
  (`ai_actions` + `audit_logs`) for the dashboard to surface as "needs staff attention"; actually
  routing the call is the partner's telephony layer.
