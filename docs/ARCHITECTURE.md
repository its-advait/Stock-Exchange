# AEZ Stock Exchange — Architecture

## 1. System overview

AEZ Stock Exchange is a multiplayer fictional exchange. Users register, receive exactly $10,000 of virtual cash, and trade 45 securities through a real central limit order book. Prices move only when trades execute.

```
 Browser (React SPA) ──HTTPS──► Fastify (one Node process)
   │  REST /api/*                 ├─ auth, market data, orders, portfolio, admin routes
   │  Socket.IO /socket.io  ◄──── ├─ Socket.IO server (rooms: market, ticker:T, user:id)
   │                              ├─ matching engine (one DB transaction per order/cancel)
   │                              ├─ outbox relay (LISTEN/poll → Socket.IO emit)
   │                              └─ static hosting of the built SPA (same origin)
   │                                        │
   └──────────────────────────────── PostgreSQL (the only source of truth)
```

Repository layout:

```
packages/shared   Zod schemas, API and Socket.IO types, the canonical 45-ticker universe, fictional content
apps/server       Fastify API, matching engine, Socket.IO, outbox relay, scripts, Vitest suites
  drizzle/        SQL migrations (0000 generated, 0001 hand-written triggers, 0002 UI support)
  src/engine/     matching.ts (CLOB), book.ts (depth), tradability.ts
  src/services/   sessions, accounts, portfolio, leaderboards, halts, market maker, import, reset, integrity
  src/realtime/   outboxRelay.ts, socket.ts
apps/web          React SPA; e2e/ holds the Playwright suites
data/import       template for the original securities dataset
```

In production a single container serves the API, WebSockets and the SPA from one origin, so session cookies are first-party and CORS is not involved in normal use.

## 2. Technology choices

| Choice | Why |
| --- | --- |
| TypeScript end to end | One type system for API payloads, Socket.IO events and the engine; shared schemas in `packages/shared`. |
| Fastify 5 | Fast, schema-friendly, first-class hooks for auth, CSRF checks and rate limiting. |
| PostgreSQL | ACID transactions, row locks, CHECK constraints, partial indexes, LISTEN/NOTIFY. Every correctness guarantee is enforced where the data lives. |
| Drizzle ORM + raw SQL | Drizzle for schema and migrations; raw parameterized SQL in the engine, where exact lock statements matter. |
| Integer cents (`BIGINT`/`bigint`) | No floating point on the money path. JSON serialization refuses values above 2^53 rather than rounding. |
| Socket.IO + transactional outbox | Rooms per ticker and per user; the outbox guarantees events exist only for committed changes. |
| argon2id, HttpOnly cookies, Zod | OWASP-recommended hashing; tokens unreadable by scripts; every request body validated. |
| React 19, Vite, TanStack Query, Tailwind, Radix, Lightweight Charts | Server state cached and patched by real-time events; accessible primitives; real-execution charts. |
| Vitest + Playwright | Engine and HTTP tests against a real Postgres; browser tests against the production build. |

## 3. Database schema

| Table | Purpose | Key constraints and indexes |
| --- | --- | --- |
| `users` | Accounts (`HUMAN` or `MARKET_MAKER`; `USER` or `ADMIN`) | unique `lower(username)` |
| `sessions` | Session id = SHA-256 of the cookie token | expiry, idle, revoked |
| `securities` | 45 listings: status, reference price and its source, last price, `book_version` | ticker PK; status/source consistency checks |
| `security_history_notes` | Historical assignment annotations | |
| `cash_accounts` | `cash_cents`, `reserved_cents` | `cash ≥ 0`, `0 ≤ reserved ≤ cash` |
| `holdings` | `quantity`, `reserved_quantity`, cost basis, realized P&L | `0 ≤ reserved ≤ quantity` |
| `orders` | Every order, including rejected ones; `seq` from `order_acceptance_seq` | market orders can never be open; fill/status consistency; partial indexes for the book |
| `trades` | Executions, both order ids, maker/taker, seller realized P&L | `buyer ≠ seller`; positive price and quantity |
| `cash_ledger`, `position_ledger` | Append-only journals with `balance_after` | triggers forbid UPDATE/DELETE |
| `security_issuance` | Immutable share creation | triggers forbid UPDATE/DELETE/TRUNCATE |
| `price_history` | Exactly one row per execution | |
| `market_maker_configs` | Inventory and quote levels per ticker, approver, opened epoch | |
| `trading_halts` | Market-wide and per-symbol halts | one active halt per scope |
| `idempotency_keys` | `(user_id, key)` PK, request hash, stored response | |
| `audit_logs` | Every admin action | append-only trigger |
| `outbox_events` | Pending and published real-time events | |
| `simulation_resets`, `market_state` | Reset history; singleton lock target and epoch | |
| `news_posts`, `watchlist_items` | Parody news; per-user watchlists | headline/body length checks |

Important indexes: `orders_book_bids_idx (ticker, limit_price DESC, seq) WHERE side='BUY' AND open`, `orders_book_asks_idx (ticker, limit_price ASC, seq) WHERE side='SELL' AND open`, open orders per user, trades per ticker and per user, ledgers per user, price history per ticker and time.

## 4. Order-book data structures

The book is not a separate structure: it is the set of open rows in `orders`, kept in two **partial B-tree indexes**, one per side, ordered exactly by priority: `(ticker, price, seq)`. Filled, cancelled and rejected orders leave the index automatically when their status changes, so the index holds only live liquidity.

* Best bid / best ask: the first entry of the relevant index for the ticker.
* Depth (`GET /book`): an aggregate over the index, grouped by price.
* `securities.book_version` increments on every book change; clients use it to detect missed updates.

## 5. Price-time priority algorithm

For an incoming order, the engine walks the opposite side in index order with keyset pagination (batches of 200):

```
asks: ORDER BY limit_price ASC,  seq ASC   (lowest ask first, then earliest)
bids: ORDER BY limit_price DESC, seq ASC   (highest bid first, then earliest)
eligible while: incoming is MARKET, or bid ≥ ask
```

For each resting order in that order:

1. If it belongs to the incoming order's owner: **stop** (self-trade prevention, see below).
2. Fill `min(remaining incoming, remaining resting)`, further capped for a market buy by `floor(budget / price)`.
3. The fill price is the **resting** order's limit price.

`seq` comes from a Postgres sequence assigned while the symbol lock is held, so within a ticker `seq` order is exactly acceptance order. Timestamps never break ties.

**Self-trade prevention: cancel the incoming remainder.** Fills already made stand; the incoming order never skips past its own resting order to reach worse-priced liquidity, and never rests (it would cross the book). The `trades_no_self_trade` CHECK enforces it again in the database.

## 6. Execution flow

`POST /api/orders` → Zod validation → `placeOrder()`, a single transaction:

1. **Idempotency:** insert `(user, Idempotency-Key, request hash)`. A duplicate waits on the primary key, then replays the stored response. A different body under the same key returns 409.
2. **Market state:** `market_state FOR SHARE`; reject if a market-wide halt is active.
3. **Symbol lock:** `securities FOR UPDATE`; reject if not tradable (unverified status or price, SUSPENDED/UNLISTED/HALTED listing, symbol halt). Rejections are stored as `REJECTED` orders and return 422.
4. **Plan** fills from the frozen book (section 5).
5. **Lock accounts:** every involved `cash_accounts` row, then every `holdings` row, sorted by `user_id`.
6. **Validate** the taker against *available* balances (section 7).
7. **Write:** the taker order in its final state; maker order updates; `trades`; `price_history`; cash and position ledger rows for both sides; balances (one update per account); last price and `book_version`; outbox events; the stored idempotent response.
8. **Commit.** Then the relay pushes the events.

Cancel (`DELETE /api/orders/:id`) takes the same locks in the same order, releases exactly the remaining reservation, and is allowed during halts.

## 7. Cash and share reservation handling

* Available cash = `cash − reserved`; available shares = `quantity − reserved_quantity`.
* **Limit buy:** needs `qty × limit` available. Fills are paid at the resting price. The remainder rests with exactly `remaining × limit` reserved, so price improvement is released automatically.
* **Market buy:** needs a `maxSpendCents` budget ≤ available cash and never spends more than it. Nothing is reserved because it never rests.
* **Sells:** need `qty` available shares; the resting remainder reserves its shares.
* **Resting bid filled by an incoming sell:** the maker paid exactly its own limit, so its reservation drops by exactly the notional.
* **Cancel:** releases the order's `reserved_cents` or `reserved_quantity`, which always equals what remains.
* The database checks `reserved ≤ cash` and `reserved_quantity ≤ quantity`, and the integrity check confirms that reservations equal the sum over open orders.

Short selling is impossible: a sell needs owned, unreserved shares.

## 8. Concurrency and locking strategy

Deterministic lock order, identical in every code path:

```
0. idempotency_keys (user, key)        placement only; private to the request
1. market_state id=1   FOR SHARE       halts and reset take FOR UPDATE
2. securities (ticker) FOR UPDATE      at most one per transaction
3. cash_accounts       FOR UPDATE, ascending user_id
4. holdings (ticker)   FOR UPDATE, ascending user_id
5. orders rows                          already serialized by lock 2
```

* The symbol lock serializes all book changes for one ticker, so matching is single-threaded per symbol while different symbols run in parallel.
* All account locks are taken in one sorted statement after the full counterparty set is known (possible because the book is frozen). Two transactions on different tickers that share users always lock them in the same order, so they cannot deadlock.
* A halt or reset takes `market_state FOR UPDATE`. It waits for in-flight orders, and new orders wait for it, so nothing slips through after a halt commits.
* `withTx` retries serialization failures and deadlocks (`40001`, `40P01`) as a safety net.
* Every guarantee is a Postgres lock or constraint, so it holds unchanged with several backend instances.

## 9. Database atomicity

One placement or cancel is one transaction. Balances, holdings, reservations, order states, trades, ledgers, last price, idempotent response and outbox events commit together or not at all. CHECK constraints and append-only triggers are the last line of defense: a bug that would corrupt state aborts the transaction instead of committing. `test/rollback.test.ts` and verification item 14 inject a failure after every write and assert that nothing changed (row counts, balances, reservations, last price, book version and outbox).

## 10. Crash recovery

There is nothing to recover in memory: the book, balances, reservations and history are all committed rows. A process that dies mid-transaction leaves no trace, because Postgres rolls back the uncommitted transaction. After a restart:

* matching continues from the durable book; `seq` keeps increasing;
* committed-but-unpublished outbox events are delivered by the new relay, in order;
* clients reconnect, rejoin their rooms and refetch snapshots.

This is tested in `test/recovery.test.ts`, verification item 17, and the production rehearsal (stop and restart the server, then compare state).

## 11. Real-time synchronization

* **Server:** state-changing transactions insert `outbox_events` rows and call `pg_notify`, both inside the transaction, so an event exists only if its change committed. `OutboxRelay` LISTENs (with polling as a fallback), claims batches with `FOR UPDATE SKIP LOCKED`, emits them to Socket.IO rooms, and marks them published. Delivery is at-least-once.
* **Rooms:** `market` (everyone), `ticker:T` (joined via `subscribe`; public data), `user:id` (joined only by the server after validating the session cookie in the handshake). Logout disconnects that session's sockets.
* **Client:** REST snapshots are the source of truth. Events patch or invalidate TanStack Query caches. Events are de-duplicated by `eventId`; a book event older than the cached `bookVersion` is ignored; after any reconnect every query is refetched and ticker rooms are rejoined. The header shows Live / Connecting / Reconnecting / Offline.
* With `SOCKET_IO_PG_ADAPTER=true`, the Socket.IO Postgres adapter fans emits out across instances.

## 12. Security model

* **Passwords:** argon2id (m=19 MiB, t=2). Login failures share one message, and unknown users are timed with a dummy hash.
* **Sessions:** 256-bit random token in an `HttpOnly`, `SameSite=Lax`, `Secure` (in production) cookie. Only its SHA-256 is stored. Absolute TTL plus idle timeout; revoked on logout and when an account is disabled. Production refuses to start with insecure cookies.
* **CSRF:** SameSite cookies; an Origin allow-list on every state-changing request; requests marked `Sec-Fetch-Site: cross-site` are rejected even without an Origin; JSON-only bodies.
* **Cross-origin:** CORS and the Socket.IO handshake accept only `WEB_ORIGINS` (https only in production; derived from `RAILWAY_PUBLIC_DOMAIN` when unset).
* **XSS:** React escapes all output, and there are no raw-HTML sinks. The SPA is served with a strict CSP (`script-src 'self'` plus the hash of the one inline theme script, `frame-ancestors 'none'`, `object-src 'none'`), and Helmet adds HSTS, nosniff and frame protection.
* **Injection:** all SQL is parameterized; the only interpolated fragments are code constants.
* **Authorization:** account data comes only from the session user; other users' orders return 404. Every `/api/admin/*` route requires `ADMIN`, and admin actions are written to an append-only audit log.
* **No wallet editing:** there is no endpoint that sets a balance. Cash is created only by the $10,000 grant and the documented market-maker funding; trades are zero-sum.
* **Rate limits:** global 600/min per user or IP, login and register 10/min, orders 120/min, reset 3 per 10 minutes.
* **Reset:** requires an admin re-entering their password, the exact confirmation phrase and an active market-wide halt. It is audited and never runs during deployment.
* **Errors:** `{ error: { code, message } }`; 5xx responses never include internals. Logs redact cookies and authorization headers.
* **Secrets:** read from the environment only; `.env` files are git-ignored.

## 13. Performance characteristics and optimizations

Operational complexity in the current design (N = open orders for the ticker, k = resting orders filled):

| Operation | Cost |
| --- | --- |
| Insert a resting order | one row insert + one partial-index insert: O(log N) |
| Find best bid/ask | first entry of the side's partial index: O(log N) |
| Fill an incoming order | O(k log N): k index reads in priority order, k order updates, k trade and ledger inserts |
| Cancel | primary-key lookup + index removal: O(log N) |
| Depth snapshot | grouped scan of the open orders for one ticker |

Optimizations in place:

* Partial indexes keep only live liquidity in the matching path.
* Keyset pagination walks the book without OFFSET.
* Account rows are locked once, updated in memory over the locked rows, and flushed once per account.
* Matching is serialized per symbol only, so different tickers trade in parallel.
* Outbox claiming uses `SKIP LOCKED`, so multiple relays don't contend.
* The client patches caches from events instead of refetching.
* The SPA is code-split with long-lived, hashed assets.

**Why PostgreSQL is the source of truth.** At AEZ scale (45 symbols, hundreds of users), a durable, transactional store gives exact ACID semantics for every trade with very little machinery: locks for serialization, constraints for invariants, and NOTIFY plus an outbox for real-time delivery. An in-memory engine would need its own journal, snapshotting and recovery, and every one of those is a place to lose or duplicate money.

**At larger scale** the appropriate steps are, in order:

1. Pool connections (PgBouncer) and run several stateless API instances with the Socket.IO Postgres or Redis adapter, plus a shared rate-limit store.
2. Move matching into one single-threaded matcher per symbol shard, holding the book in memory:
   * per side, a sorted map from price to a FIFO queue (red-black tree or skip list): O(log P) to add a price level, O(1) to read the best price;
   * a hash map from order id to its queue node: O(1) cancel;
   * fills are O(1) per resting order.
   Orders enter through a durable ordered log (Kafka, or a Postgres journal table); executions are emitted as journal entries, and a risk service pre-reserves balances. The book is rebuilt on restart from a snapshot plus the log tail, so memory stays a cache of the log.
3. Partition the trades and ledger tables by time and serve history from read replicas.

## 14. Limitations and future improvements

* **Original data:** the original starting prices and listing restrictions have not been supplied. All 45 securities stay non-tradable until the dataset is imported (`docs/DATA_IMPORT.md`), unless an admin applies a clearly labeled SIMULATED reference price.
* **Rate limits** are in-memory per instance; use a shared store before running several replicas.
* **Not load-tested:** concurrency has been tested (hundreds of concurrent orders across accounts and tickers), but there is no measured throughput figure.
* **Highest profit and highest return** always order identically, because every account starts with the same cash.
* **Portfolio history** values holdings at the reference price before a security's first trade.
* **Lists** show the most recent entries up to fixed limits; the API supports cursor pagination, but the UI has no "load more".
* **No email verification or password reset by users;** an admin can set a new password, which revokes that user's sessions.
* **News** posts are plain text; posts can be hidden but not edited.
