# Database

PostgreSQL. All primary keys are `uuid DEFAULT gen_random_uuid()` (via the `pgcrypto` extension) —
not sequential integers — so that IDs exposed to the AI/API are not guessable/enumerable
(an attacker who can see reservation `a1b2...` learns nothing about how many other reservations
exist or how to find reservation `a1b2...-1`).

All money is stored as integer cents (`price_cents`, `subtotal_cents`, ...) to avoid floating-point
rounding bugs in totals.

Every table has `created_at` / `updated_at` (`updated_at` maintained by a trigger, not
application code, so it can't be forgotten in some code path).

## Tables

### `restaurants`
The tenant root.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text not null | |
| slug | text unique not null | used in URLs / phone-number routing lookups |
| phone | text | the restaurant's own line |
| address | text | shown by `get_restaurant_info` and the dashboard; no structured geocoding in v1 |
| timezone | text not null default 'Asia/Kathmandu' | all date/time logic resolves in this zone |
| opening_hours | jsonb not null | per-weekday open/close, used by alternative-time search |
| allow_table_combination | boolean not null default false | gates multi-table allocation |
| is_active | boolean not null default true | |

### `users`
Staff/admin accounts (dashboard login). Not customers.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| email | text unique not null | |
| password_hash | text not null | bcrypt, never the plaintext |
| name | text not null | |
| is_platform_admin | boolean not null default false | cross-restaurant superadmin, distinct from per-restaurant role |

### `restaurant_users`
The tenant-membership join — **this is what authorization is derived from**, never a client-sent
`restaurantId`.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| restaurant_id | uuid fk → restaurants | |
| user_id | uuid fk → users | |
| role | text check in ('owner','manager','staff') | |
| unique(restaurant_id, user_id) | | |

### `tables`
Physical tables available for seating.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| restaurant_id | uuid fk → restaurants | |
| label | text not null | e.g. "T4" |
| capacity | int not null check (capacity > 0) | |
| is_active | boolean not null default true | |

Index: `(restaurant_id, is_active, capacity)` — the exact query shape the allocation algorithm uses.

### `menu_categories`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| restaurant_id | uuid fk → restaurants | |
| name | text not null | |
| display_order | int not null default 0 | |

### `menu_items`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| restaurant_id | uuid fk → restaurants | |
| category_id | uuid fk → menu_categories | |
| name | text not null | |
| description | text | |
| price_cents | int not null check (price_cents >= 0) | source of truth for pricing — see DECISIONS.md |
| is_available | boolean not null default true | |

### `customers`
A caller, identified by phone number per restaurant (no login/account — voice is phone-number
authenticated by construction).
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| restaurant_id | uuid fk → restaurants | |
| phone | text not null | |
| name | text | |
| unique(restaurant_id, phone) | | |

### `reservations`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| restaurant_id | uuid fk → restaurants | |
| customer_id | uuid fk → customers | |
| party_size | int not null check (party_size > 0) | |
| reservation_date | date not null | |
| reservation_time | time not null | |
| duration_minutes | int not null default 90 | |
| time_range | tsrange generated always as (...) stored | derived from date+time+duration, see below |
| status | text not null check in ('PENDING','CONFIRMED','CANCELLED','COMPLETED','NO_SHOW') | |
| special_requests | text | |
| idempotency_key | text | |
| unique(restaurant_id, idempotency_key) | | nullable key = no idempotency requested |

No `table_id` column directly on `reservations` — table assignment (one table, or several when
combined) is always recorded via `reservation_tables`, so single-table and combined bookings use
the exact same allocation/locking code path (see "Preventing double-booking" below).

### `reservation_tables`
Join table recording which table(s) a reservation occupies — one row for the common single-table
case, several rows when seating was combined (only when `restaurants.allow_table_combination` is
true).
| column | type | notes |
|---|---|---|
| reservation_id | uuid fk → reservations | |
| table_id | uuid fk → tables | |
| primary key (reservation_id, table_id) | | |

### `orders`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| restaurant_id | uuid fk → restaurants | |
| customer_id | uuid fk → customers | |
| reservation_id | uuid fk → reservations, nullable | an order can be dine-in-with-reservation or standalone |
| status | text not null check in ('PENDING','CONFIRMED','PREPARING','COMPLETED','CANCELLED') | |
| subtotal_cents | int not null | sum of line items, computed by the backend, never client-supplied |
| total_cents | int not null | subtotal (+ tax/service in future; v1: equal to subtotal) |
| idempotency_key | text | |
| unique(restaurant_id, idempotency_key) | | |

### `order_items`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| order_id | uuid fk → orders | |
| menu_item_id | uuid fk → menu_items | |
| quantity | int not null check (quantity > 0) | |
| unit_price_cents | int not null | **snapshotted** from `menu_items.price_cents` at order time |
| line_total_cents | int not null | `quantity * unit_price_cents`, computed server-side |

Snapshotting the price means a later menu price change never retroactively changes a historical
order's total — and it's what makes "never trust a client-supplied price" concrete: the backend
reads `menu_items.price_cents` itself and ignores any price field in the request body entirely.

### `conversation_sessions`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| restaurant_id | uuid fk → restaurants | |
| customer_phone | text | |
| channel | text not null default 'voice' | |
| state | jsonb not null default '{}' | the slot-filling state, see ARCHITECTURE.md |
| status | text not null check in ('ACTIVE','COMPLETED','ABANDONED') | |
| started_at | timestamptz not null default now() | |
| ended_at | timestamptz | |

### `conversation_messages`
Transcript, mainly for the dashboard and for debugging agent behavior.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| session_id | uuid fk → conversation_sessions | |
| role | text not null check in ('customer','ai','system') | |
| content | text not null | length-capped at the validator; never rendered as HTML anywhere |

### `ai_actions`
Every tool call the AI makes, for the partner's dashboard "AI activity" view and for debugging.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| session_id | uuid fk → conversation_sessions, nullable | |
| restaurant_id | uuid fk → restaurants | |
| tool_name | text not null | |
| status | text not null check in ('SUCCESS','FAILURE') | |
| duration_ms | int | |
| sanitized_input | jsonb | validated args only, never raw headers/tokens |
| sanitized_result | jsonb | the structured result returned to the AI |

### `audit_logs`
Generic trail for admin/staff actions taken through the dashboard (separate from `ai_actions`,
which is specifically AI tool calls).
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| restaurant_id | uuid fk → restaurants, nullable | nullable for platform-admin actions |
| actor_type | text not null check in ('user','ai','system') | |
| actor_id | text | |
| action | text not null | |
| resource_type | text | |
| resource_id | text | |
| metadata | jsonb | |

## Preventing double-booking (concurrency)

Two calls racing to book the last table for the same slot must not both succeed. Checking
availability then inserting in two separate steps is **not** safe — both requests can read
"available" before either writes, since nothing stops a second transaction from reading the same
"before" state while the first transaction's write is still in flight.

`reservations.time_range` is a generated `tsrange` column (`tsrange(reservation_date +
reservation_time, reservation_date + reservation_time + duration_minutes * interval '1 minute')`),
used for overlap checks (`&&`). Allocation runs inside a single transaction that:

1. `SELECT id FROM tables WHERE id = ANY($candidateTableIds) FOR UPDATE` — takes a row lock on
   every table being considered for this booking (one row for a single-table reservation, several
   for a combined one). A second, concurrent transaction trying to allocate any of the *same*
   table rows blocks here until the first transaction commits or rolls back — this is what
   actually closes the race window, not the earlier read.
2. While still holding those locks, re-check for any active (`PENDING`/`CONFIRMED`)
   `reservation_tables` rows joined to `reservations` whose `time_range` overlaps the requested
   slot, for those same table ids.
3. If none overlap, insert the `reservations` row and its `reservation_tables` row(s), then
   `COMMIT` (releasing the locks). If an overlap is found, `ROLLBACK` and report
   `RESERVATION_UNAVAILABLE`.

The initial availability check the AI/customer sees (`check_table_availability`) is a plain read
with no lock — it's only there to give a fast, friendly answer and candidate table ids. The
locking transaction above is what's actually safety-critical, and it's re-run in full on
`create_reservation` regardless of what the earlier availability check said, because that check
could be stale by the time the booking is attempted. One table-locking transaction handles both
the single-table case and the allowed-combination case identically — see `DECISIONS.md` for why
this was chosen over a declarative `EXCLUDE` constraint once combination seating needed a join
table.

## Idempotency

`reservations` and `orders` both carry a nullable `idempotency_key` with a
`unique(restaurant_id, idempotency_key)` constraint. A client (the AI orchestrator, retrying after
a dropped response) sends the same `Idempotency-Key` header on a retried `POST`; the service looks
up an existing row with that key first and returns it unchanged instead of creating a duplicate.
