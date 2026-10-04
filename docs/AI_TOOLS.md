# AI Tools

Status: design phase — signatures below are the contract Phase 12 implements against. Each tool is
a specific REST endpoint under `/api/v1/ai/tools/*`, callable only with a session-scoped AI token
(see `SECURITY.md`). The AI never calls anything else to affect restaurant data.

Every tool follows the same shape: strict zod input schema → reject before touching anything →
resolve `restaurantId` from the authenticated session (ignore/verify against any `restaurantId` in
the args) → business logic via the matching service → structured, minimal output → logged to
`ai_actions`.

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
- **Input**: `{ date: 'YYYY-MM-DD', time: 'HH:mm', partySize: int(1..) }`
- **Validation**: date not in the past (restaurant timezone), within opening hours, partySize > 0
  and ≤ largest combinable capacity.
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
  exclusion constraint as the final word, see `DATABASE.md`).
- **Output (success)**: `{ success: true, reservationId, status: 'CONFIRMED', date, time, partySize }`
- **Output (lost race / now unavailable)**: `{ success: false, error: { code: 'RESERVATION_UNAVAILABLE' }, alternatives: [...] }`
- **This is the tool the "AI must never claim success without backend confirmation" rule is
  sharpest on** — the controller only returns `success: true` after the INSERT actually commits.

## `get_reservation`
- **Input**: `{ reservationId: uuid }` or `{ customerPhone }` (most recent active one)
- **Output**: reservation summary (no internal table IDs, no other customers' data)
- **Authorization**: must belong to the session's resolved restaurant + match customer phone;
  otherwise 404 (not 403 — see `ERROR_HANDLING.md` IDOR note).

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
