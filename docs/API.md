# API

Status: Phases 10-12 implemented the routes below, with real authentication/authorization, zod
validation, rate limiting, and the AI tool layer — verified against a real Postgres test database
via Supertest (`tests/integration/*.test.js`) and manually against a running server (login, token
reuse, cross-tenant and cross-session access attempts, injection/XSS/mass-assignment payloads, the
full agentic check→book→confirm flow).

Base path: `/api/v1`. All request/response bodies are JSON. Resources are nested under the
restaurant they belong to: `/restaurants/:restaurantId/...`.

## Auth
- `POST /auth/login` — `{ email, password }` → `{ success, token, user, restaurants }`.
  Rate-limited (10/15min). Same `UNAUTHORIZED` error for a wrong password or an unknown email — a
  login attempt never reveals which one.

Protected routes take `Authorization: Bearer <token>` — either a staff JWT from `/auth/login`, or
an AI session token (`aiToken`) from creating a session (see below). See `SECURITY.md` for the
full authorization model.

## Health
- `GET /health` (outside `/api/v1`) — liveness check, no restaurant scope, no auth.
  `{ success: true, status: "ok" }`.

## Restaurant / menu / tables — public, no auth
A restaurant's own info/menu/tables are treated like its public website (`DECISIONS.md`).
- `GET /restaurants/:restaurantId` → `{ success, restaurant: { id, name, phone, address, openingHours, timezone } }`
- `GET /restaurants/:restaurantId/tables` → `{ success, tables: [{ id, label, capacity }] }`
- `GET /restaurants/:restaurantId/menu` (optional `?categoryId=`) →
  `{ success, categories: [{ id, name, items: [{ id, name, description, priceCents, isAvailable }] }] }`

Staff-only writes (`POST .../tables`, `POST .../menu-items`, `PATCH .../menu-items/:id`) and a
dashboard reservation-list view aren't built yet — they're the next thing this auth layer enables,
not blocked on anything further; just not required to demo the agentic core.

## Reservations — requires auth
`Authorization: Bearer <token>` required (staff JWT, with a `restaurant_users` row for this
restaurant; or an AI session token issued for this restaurant). Rate-limited (60/15min on
create/modify/cancel).
- `POST /restaurants/:restaurantId/reservations` — requires `Idempotency-Key` header.
  Body: `{ customer: { phone, name? }, date, time, partySize, specialRequests? }` (zod-validated:
  `date` must be `YYYY-MM-DD`, `time` must be `HH:mm`, `partySize` 1-50).
  → 201 `{ success, reservation: { id, status, date, time, partySize, specialRequests, tables } }`,
  or 409 `RESERVATION_UNAVAILABLE` with an `alternatives` array.
- `GET /restaurants/:restaurantId/reservations/:reservationId`
- `PATCH /restaurants/:restaurantId/reservations/:reservationId` — any of `{ date, time, partySize }`
- `POST /restaurants/:restaurantId/reservations/:reservationId/cancel` — idempotent

## Orders — requires auth
Same auth/rate-limit model as reservations.
- `POST /restaurants/:restaurantId/orders` — requires `Idempotency-Key` header.
  Body: `{ customer: { phone, name? }, items: [{ menuItemId, quantity }], reservationId? }`
  (`menuItemId`/`reservationId` must be valid UUIDs; `quantity` 1-20).
  → 201 `{ success, order: { id, status, reservationId, items, subtotalCents, totalCents } }`
- `GET /restaurants/:restaurantId/orders/:orderId`
- `PATCH /restaurants/:restaurantId/orders/:orderId` — `{ items: [...] }` (full replacement, only while `PENDING`)
- `POST /restaurants/:restaurantId/orders/:orderId/cancel` — idempotent

## Conversation sessions — creation is public, everything else requires auth
- `POST /restaurants/:restaurantId/sessions` — **no auth required** (it's the credential-issuing
  endpoint — see `DECISIONS.md`). Rate-limited (30/15min). Body: `{ customerPhone?, channel? }` →
  `{ success, session: { id, restaurantId, channel, state, status }, aiToken }`.
- `GET /restaurants/:restaurantId/sessions/:sessionId` — requires the `aiToken` this exact session
  was issued (or a staff JWT for this restaurant); a different session's `aiToken` gets 404, not
  this session's data.
- `PATCH /restaurants/:restaurantId/sessions/:sessionId` — `{ state: { ...fields to merge } }`
- `POST /restaurants/:restaurantId/sessions/:sessionId/messages` — `{ role, content }`

## AI tools — AI session token only (staff JWT rejected with 403)
`POST /api/v1/ai/tools/<tool-name>`, one per tool in `AI_TOOLS.md` (`get-restaurant-info`,
`get-menu`, `check-item-availability`, `check-table-availability`, `find-alternative-times`,
`create-reservation`, `get-reservation`, `modify-reservation`, `cancel-reservation`,
`create-order`, `modify-order`, `cancel-order`, `transfer-to-human`). No `:restaurantId` in the
URL — it comes entirely from the AI session token, so there's no argument anywhere that could
redirect a call to a different restaurant. Rate-limited (300/15min — a single conversation turn
can involve several tool calls). Every call is logged to `ai_actions`, success or failure. See
`AI_TOOLS.md` for each tool's exact input/output shape.

## Not yet built
- `GET /restaurants/:id/reservations` dashboard list view (needs no new auth — the mechanism
  exists — just not built yet)
- `POST`/`PATCH` on tables and menu items (staff-only; same note)

## Example (as implemented)

```
POST /api/v1/restaurants/dcadba63-.../reservations
Authorization: Bearer eyJhbGciOi...
Idempotency-Key: 3f9c2e1a-...
Content-Type: application/json

{
  "customer": { "name": "Saurav", "phone": "+977..." },
  "date": "2026-10-05",
  "time": "19:00",
  "partySize": 5
}
```

```json
{
  "success": true,
  "reservation": {
    "id": "8571a626-...",
    "status": "CONFIRMED",
    "date": "2026-10-05",
    "time": "19:00:00",
    "partySize": 5,
    "specialRequests": null,
    "tables": [{ "id": "...", "label": "T5", "capacity": 6 }]
  }
}
```
