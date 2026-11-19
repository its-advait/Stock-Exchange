# AEZ Stock Exchange — Architecture

## Layout

```
packages/shared      Zod request schemas, API/Socket.IO types, canonical 45-ticker universe, money helpers
apps/server          Fastify API, matching engine, Socket.IO, outbox relay, scripts, Vitest suite
  drizzle/           SQL migrations (0000 generated from src/db/schema.ts, 0001 hand-written triggers)
  src/engine/        matching.ts (CLOB), book.ts (depth), tradability.ts
  src/services/      auth/sessions, portfolio/leaderboard, halts, market maker + issuance, import, reset, integrity
  src/realtime/      outboxRelay.ts, socket.ts
apps/web             frontend (not built yet)
data/import          template for the original securities dataset
```

PostgreSQL is the **only** source of truth. Nothing the server keeps in memory (apart from rate-limit counters) matters for correctness.
If a process dies at any point, restarting it changes nothing: every order, reservation, and execution is either committed or never happened.

## Money and quantities

* Money is `BIGINT` integer cents in the database and `bigint` in TypeScript. No floating point anywhere on the money path.
* Shares are `BIGINT` integers. Prices must be greater than 0.
* JSON carries integer cents as numbers. The serializer refuses any value above 2^53 instead of rounding it.
* Rounding is integer division, which only happens in two places:
  * average-cost basis removal on a sell, floored;
  * market-maker level prices, rounded half up.

## Matching engine (`src/engine/matching.ts`)

It is a central limit order book with **price-time priority**:

* The highest bid matches first, and the lowest ask matches first.
* At equal prices, the order with the lower `seq` matches first.
* Fills always happen at the **resting** order's limit price.
* Orders match only when bid ≥ ask.

`seq` comes from the Postgres sequence `order_acceptance_seq`. It is assigned while the transaction holds that symbol's lock, so within a ticker `seq` order is exactly acceptance order. Timestamps are never used to break ties.

Each placement is **one transaction**:

1. **Idempotency check:** insert `(user_id, Idempotency-Key)` with `ON CONFLICT DO NOTHING`.
   * A concurrent duplicate blocks on the primary key until the first request commits, then replays the stored response.
   * Reusing a key with a different body returns 409.
2. **Market halt check:** `market_state FOR SHARE`, then check for a market-wide halt.
3. **Symbol lock:** `securities FOR UPDATE`. Every change to that ticker's book (placement, cancel, issuance, market maker opening) holds this lock, so the book is frozen for the rest of the transaction.
4. **Tradability check:** status `ACTIVE`, a verified or labeled-simulated reference price, and no symbol halt. A failure is persisted as a `REJECTED` order and returns 422.
5. **Plan the fills** by walking the opposite side with keyset pagination over the partial indexes `orders_book_bids_idx` and `orders_book_asks_idx`. These are `(ticker, price DESC|ASC, seq)` and contain only resting orders.
6. **Lock accounts:** every involved `cash_accounts` row, then every `holdings` row, in **ascending `user_id`**.
7. **Validate the incoming order against available balances:**
   * Limit buy: `qty × limit ≤ cash − reserved`.
   * Market buy: `maxSpend ≤ cash − reserved`.
   * Sells: `qty ≤ shares − reserved`.
8. **Write everything:**
   * the incoming order, already in its final state;
   * maker order updates and `trades` rows;
   * `price_history`, cash ledger (both sides), and position ledger (both sides);
   * balances, flushed once per account;
   * last price and `book_version`;
   * outbox events;
   * the stored idempotent response.

If anything throws, all of it rolls back. CHECK constraints are the last line of defense, for example `reserved ≤ cash`, `cash ≥ 0`, market orders can never rest, no self-trade rows, and status/fill consistency. A bug that would corrupt balances aborts the transaction instead of committing.

### Order types

| Type | Behavior |
| --- | --- |
| LIMIT BUY | Reserves `qty × limit` up front. A fill at a better price releases the difference: the order reserved `q × limit` and paid `q × price`. The remainder rests with exactly `remaining × limit` reserved. |
| LIMIT SELL | Reserves the remaining shares while resting. |
| MARKET BUY | Requires `maxSpendCents`. Never spends more than that, and it must be ≤ available cash. Fills only against existing liquidity. The unfilled remainder is cancelled (`NO_LIQUIDITY` or `MAX_SPEND_REACHED`). Never rests; this is also a DB constraint. |
| MARKET SELL | Fills against existing bids. The remainder is cancelled. |
| Cancel | Takes the same lock order (market_state → security → order → account) and releases exactly the order's remaining reservation. Allowed during halts. |

### Self-trade prevention

The policy is **cancel the incoming remainder**. It is enforced in the engine and again by the `trades_no_self_trade` CHECK.

While walking the book in strict priority order, if the next eligible resting order belongs to the same account, matching **stops**:

* Fills already made stand.
* The incoming order's remainder is cancelled with reason `SELF_TRADE_PREVENTION`.
* The incoming order never skips its own order to reach worse liquidity.
* It never rests, because resting would cross the book.

### Deterministic lock order (deadlock freedom)

```
0. idempotency_keys (user, key)                      placement only, private to the request
1. market_state id=1   FOR SHARE                     (halt/reset: FOR UPDATE)
2. securities (ticker) FOR UPDATE                    at most one per transaction
3. cash_accounts       FOR UPDATE ORDER BY user_id
4. holdings (ticker)   FOR UPDATE ORDER BY user_id
5. orders rows                                        already serialized by lock 2
```

All of a transaction's account locks are taken in one sorted statement, after the full set of counterparties is known. That is possible because the book is frozen by lock 2.

* Two transactions on different tickers sharing users always lock those users in the same order.
* Halts and resets take `market_state FOR UPDATE`. They wait for in-flight orders, and new orders wait for them.

`withTx` still retries `40001` and `40P01` as a safety net.

This works unchanged with **many backend instances**, because every guarantee is a Postgres lock or constraint.

### Production-scale alternative

At much higher throughput you would shard by symbol. One single-threaded matcher owns each book in memory:

* A sorted map from price to a FIFO queue of orders: a red-black tree or skip list keyed by price, with one tree per side. That gives O(log P) inserts and O(1) access to best bid/ask.
* A hash map from order id to its queue node, for O(1) cancels.

Inbound orders go through a durable, ordered log (Kafka, or a Postgres journal table) that the matcher consumes in sequence. The matcher emits executions as journal entries. Balances are pre-reserved by a risk/accounting service before an order reaches the matcher.

On restart, the book is rebuilt by replaying the journal, or from a snapshot plus the tail. Memory is a cache of the log, never the source of truth.

At AEZ scale (45 symbols, hundreds of users), indexed Postgres queries under row locks are simpler and fully ACID.

## Share supply and the market maker

* Shares are created **only** by `issueShares`. In one transaction it writes an immutable `security_issuance` row, increases `holdings`, and writes a `position_ledger` ISSUANCE row.
* A trigger forbids UPDATE, DELETE, and TRUNCATE on issuance rows. Trades only move shares between accounts.
* The invariant per ticker: `Σ holdings.quantity = Σ issuance.quantity (current epoch)`.
* Cash is created only by `INITIAL_GRANT` ($10,000 per human) and `MARKET_MAKER_FUNDING`. Trades are zero-sum transfers, so `Σ cash = Σ grants`.

`GET /api/admin/integrity` and `npm run db:integrity` check:

* supply, cash, ledgers vs balances, reservations vs open orders;
* order fills vs trades, crossed books, and last price vs last trade.

The **system market maker** (`aez_market_maker`, account_type `MARKET_MAKER`) is an ordinary account:

* It cannot log in, and it is excluded from the leaderboard.
* It starts with `MARKET_MAKER_STARTING_CASH_CENTS` ($250,000 by default) and **no shares**.

Admin flow:

1. `PUT /api/admin/market-maker/:ticker` sets inventory and ask/bid levels as basis-point offsets from the reference price. It is audited and records the approving admin.
2. `POST /api/admin/market-maker/:ticker/open` runs once per epoch, all-or-nothing:
   * It requires a tradable security.
   * It issues the inventory to the market maker.
   * It places the quotes **through the normal engine**, with normal reservations. A bid needs real cash, and an ask needs real shares.

Quotes are priced from the verified reference price, or from a reference price explicitly labeled `SIMULATED`.

## Reference data and tradability

* Seeded securities have `status = NULL` and `reference_price_cents = NULL`, which means **not tradable**.
* Real values arrive through the validated import (`docs/DATA_IMPORT.md`, source `VERIFIED_IMPORT`).
* Before the original dataset exists, an admin can set a **simulated** reference price. This requires the exact acknowledgement phrase. The price is labeled `SIMULATED` everywhere in the API, and it can never override a verified price or status.
* Original SUSPENDED/UNLISTED/HALTED statuses change only through `POST /admin/securities/:ticker/listing-status`. That route requires a `reason` and an `authorizationReference`, and the previous value is audited.
* Admin **halts** (market-wide or per symbol, in `trading_halts`) are separate from listing status. Resuming a halt never lifts a listing restriction.

The last-traded price changes only inside a matched execution. A security that has never traded shows its reference price, labeled `REFERENCE_VERIFIED` or `REFERENCE_SIMULATED`. Price history (`price_history`) has exactly one row per real execution; nothing is synthesized.

## Real-time: transactional outbox

* State-changing transactions insert `outbox_events` rows (event, room, payload) and call `pg_notify`. Both are transactional, so an event exists **iff** its change committed.
* `OutboxRelay` LISTENs and polls as a fallback. It claims batches with `FOR UPDATE SKIP LOCKED`, emits them, and marks them published.
* Delivery is at-least-once:
  * Payloads carry `eventId` (the outbox id) for de-duplication.
  * Book events carry `bookVersion`. A client that sees a gap refetches `/book`.
* Unpublished events survive restarts and are delivered by the next relay.
* With `SOCKET_IO_PG_ADAPTER=true`, the Socket.IO Postgres adapter fans every emit out to all instances.

Rooms:

| Room | Who joins | Events |
| --- | --- | --- |
| `market` | everyone, automatically | `price`, `market.status`, `security.status`, `market.reset` |
| `ticker:<T>` | via `subscribe` | `trade`, `book`, `price` (public market data) |
| `user:<id>` | joined **by the server only**, after validating the session cookie in the handshake | `order`, `portfolio.changed` |

On logout, the server disconnects that session's sockets.

## Security

* Passwords use argon2id (OWASP m=19 MiB, t=2).
  * Login failures have a uniform message, and timing is equalized with a dummy-hash verify for unknown users.
* Sessions use a 256-bit random token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). The database stores **only its SHA-256**.
  * Absolute TTL plus idle timeout.
  * Revoked on logout, password reset, and disable.
* CSRF:
  * SameSite cookies.
  * Origin allow-list on state-changing requests.
  * JSON-only bodies (`text/plain` parser removed).
* Rate limits:
  * global 600/min per user or IP;
  * login/register 10/min;
  * orders 120/min;
  * reset 3 per 10 minutes.
  * Counters are in memory per instance; use a Redis store for strict global limits across instances.
* Every admin route requires the `ADMIN` role, and admin actions are written to `audit_logs`, which is append-only via trigger.
* No endpoint changes wallet balances.
* Simulation reset requires all of:
  * an admin who re-enters their password;
  * the exact phrase `RESET THE AEZ STOCK EXCHANGE SIMULATION`;
  * an active market-wide halt.

  It deletes orders, trades, ledgers, and holdings (the delete is allowed only via a transaction-local flag), regrants cash, and starts a new epoch. Issuance history is kept.
* Errors return `{ error: { code, message } }`. 5xx errors never include internals.

## Database tables

| Table | Purpose |
| --- | --- |
| `users`, `sessions` | Accounts and sessions |
| `securities`, `security_history_notes` | Listings and historical notes |
| `cash_accounts`, `holdings` | Balances |
| `orders`, `trades` | Order book and executions |
| `cash_ledger`, `position_ledger` | Ledgers |
| `security_issuance` | Share issuance |
| `price_history` | One row per execution |
| `market_maker_configs` | Market-maker settings |
| `trading_halts` | Market-wide and per-symbol halts |
| `idempotency_keys` | Idempotent order placement |
| `audit_logs` | Admin and system actions |
| `outbox_events` | Real-time event outbox |
| `simulation_resets` | Reset history |
| `market_state` | Singleton: lock target and current epoch |

Migrations live in `apps/server/drizzle/`.
