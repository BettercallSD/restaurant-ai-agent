# API

Status: design phase — endpoint list below is implemented starting Phase 10. Each endpoint gets a
full entry (purpose, auth, request, response, validation, errors, example) here as it's built;
until then this is the planned surface.

Base path: `/api/v1`. All request/response bodies are JSON. Auth is `Authorization: Bearer <token>`
(staff JWT, or an AI-session token — see `SECURITY.md`).

## Auth
- `POST /auth/login` — staff login (email + password) → JWT. Rate-limited.

## Restaurant / menu (mostly dashboard-facing, read paths also used by AI tools internally)
- `GET /restaurants/:id`
- `GET /restaurants/:id/tables`
- `POST /restaurants/:id/tables` (staff, manager+)
- `GET /restaurants/:id/menu`
- `POST /restaurants/:id/menu-items` (staff, manager+)
- `PATCH /restaurants/:id/menu-items/:itemId` (staff, manager+)

## Reservations
- `POST /reservations` — requires `Idempotency-Key` header
- `GET /reservations/:id`
- `PATCH /reservations/:id`
- `POST /reservations/:id/cancel`
- `GET /reservations?restaurantId=&date=` (dashboard list view, staff-scoped)

## Orders
- `POST /orders` — requires `Idempotency-Key` header
- `GET /orders/:id`
- `PATCH /orders/:id`
- `POST /orders/:id/cancel`

## Conversation sessions (used by the AI orchestrator)
- `POST /sessions` — create a session for an inbound call, scoped to the restaurant the dialed
  number resolves to; returns the session-scoped AI token
- `GET /sessions/:id`
- `PATCH /sessions/:id` — merge-patch `state`
- `POST /sessions/:id/messages` — append a transcript entry

## AI tools
- `POST /ai/tools/get-restaurant-info`
- `POST /ai/tools/get-menu`
- `POST /ai/tools/check-item-availability`
- `POST /ai/tools/check-table-availability`
- `POST /ai/tools/find-alternative-times`
- `POST /ai/tools/create-reservation`
- `POST /ai/tools/get-reservation`
- `POST /ai/tools/modify-reservation`
- `POST /ai/tools/cancel-reservation`
- `POST /ai/tools/create-order`
- `POST /ai/tools/modify-order`
- `POST /ai/tools/cancel-order`
- `POST /ai/tools/transfer-to-human`

See `AI_TOOLS.md` for each tool's exact input/output contract and `INTEGRATION.md` for how the
partner's orchestrator is expected to call these.

## Example (filled in fully once implemented)

```
POST /api/v1/reservations
Authorization: Bearer <token>
Idempotency-Key: 3f9c...

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
    "id": "...",
    "status": "CONFIRMED",
    "date": "2026-10-05",
    "time": "19:00",
    "partySize": 5
  }
}
```
