# API

Status: Phase 10 implemented the routes below (restaurant/menu/tables, reservations, orders,
sessions) and verified each one against a real Postgres test database via Supertest
(`tests/integration/api.test.js`). **No authentication exists yet** — every route resolves the
restaurant purely from the URL's `:restaurantId` with no check that the caller is allowed to act
on it (see the ⚠️ warning in `src/middleware/resolveRestaurant.js`). Auth, the `Idempotency-Key`→
zod-schema upgrade, and the `/auth/login` + AI-tool endpoints below land in Phase 11/12 — don't
treat this surface as tenant-isolated until then. This file is updated again once that lands.

Base path: `/api/v1`. All request/response bodies are JSON. Resources are nested under the
restaurant they belong to: `/restaurants/:restaurantId/...`.

## Health
- `GET /health` (outside `/api/v1`) — liveness check, no restaurant scope. `{ success: true, status: "ok" }`.

## Restaurant / menu / tables (implemented, read-only)
- `GET /restaurants/:restaurantId` → `{ success, restaurant: { id, name, phone, address, openingHours, timezone } }`
- `GET /restaurants/:restaurantId/tables` → `{ success, tables: [{ id, label, capacity }] }`
- `GET /restaurants/:restaurantId/menu` (optional `?categoryId=`) →
  `{ success, categories: [{ id, name, items: [{ id, name, description, priceCents, isAvailable }] }] }`

Staff-only writes (`POST .../tables`, `POST .../menu-items`, `PATCH .../menu-items/:id`) are
intentionally **not built yet** — building a mutation endpoint before auth exists would let anyone
edit any restaurant's menu, which is worse than not having the endpoint. They land with Phase 11.

## Reservations (implemented)
- `POST /restaurants/:restaurantId/reservations` — requires `Idempotency-Key` header.
  Body: `{ customer: { phone, name? }, date, time, partySize, specialRequests? }`.
  → 201 `{ success, reservation: { id, status, date, time, partySize, specialRequests, tables } }`,
  or 409 `RESERVATION_UNAVAILABLE` with an `alternatives` array (see `ERROR_HANDLING.md`).
- `GET /restaurants/:restaurantId/reservations/:reservationId`
- `PATCH /restaurants/:restaurantId/reservations/:reservationId` — any of `{ date, time, partySize }`
- `POST /restaurants/:restaurantId/reservations/:reservationId/cancel` — idempotent

A dashboard list view (`GET .../reservations?date=`) is deferred to Phase 11 along with staff auth,
since "list every reservation" is exactly the kind of endpoint that must not be open to anyone.

## Orders (implemented)
- `POST /restaurants/:restaurantId/orders` — requires `Idempotency-Key` header.
  Body: `{ customer: { phone, name? }, items: [{ menuItemId, quantity }], reservationId? }`.
  → 201 `{ success, order: { id, status, reservationId, items, subtotalCents, totalCents } }`
- `GET /restaurants/:restaurantId/orders/:orderId`
- `PATCH /restaurants/:restaurantId/orders/:orderId` — `{ items: [...] }` (full replacement, only while `PENDING`)
- `POST /restaurants/:restaurantId/orders/:orderId/cancel` — idempotent

## Conversation sessions (implemented; used by the AI orchestrator)
- `POST /restaurants/:restaurantId/sessions` — body: `{ customerPhone?, channel? }` →
  `{ success, session: { id, restaurantId, channel, state, status } }`. **Phase 11** adds the
  session-scoped AI token to this response and requires it on subsequent calls.
- `GET /restaurants/:restaurantId/sessions/:sessionId`
- `PATCH /restaurants/:restaurantId/sessions/:sessionId` — `{ state: { ...fields to merge } }`
- `POST /restaurants/:restaurantId/sessions/:sessionId/messages` — `{ role, content }`

## Not yet built
- `POST /auth/login` (staff email+password → JWT) — Phase 11
- `GET /restaurants/:id/reservations` dashboard list — Phase 11 (needs staff auth)
- `POST`/`PATCH` on tables and menu items — Phase 11 (needs staff auth)
- `/ai/tools/*` — Phase 12; contracts already specified in `AI_TOOLS.md`

## Example (as implemented)

```
POST /api/v1/restaurants/dcadba63-.../reservations
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
