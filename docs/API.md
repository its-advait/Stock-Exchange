# AEZ Stock Exchange — API reference (for frontend integration)

Base URL: `http://localhost:4000/api`. Response types are exported from `@aez/shared` (`packages/shared/src/types.ts`), and request Zod schemas from `packages/shared/src/schemas.ts`. You can validate requests client-side with the same schemas.

## Conventions

* **Money is integer cents.** Use `formatCents()` and `parseDollarsToCents()` from `@aez/shared`. Share quantities are integers.
* **Auth.** The `aez_session` cookie is `HttpOnly`. Use `fetch(url, { credentials: 'include' })`. The frontend origin must be listed in `WEB_ORIGINS`.
* **Bodies.** Send `Content-Type: application/json`. Other body types are rejected with 415.
* **Errors.** `{ "error": { "code": "SNAKE_CASE", "message": "…", "details"?: […] } }`

  | Status | Meaning |
  | --- | --- |
  | 400 | Validation failed (`details` lists the issues) |
  | 401 | Not authenticated |
  | 403 | Forbidden |
  | 404 | Not found |
  | 409 | Conflict |
  | 415 | Unsupported body type |
  | 422 | Order rejected |
  | 429 | Rate limited |

* **Pagination** is cursor-style: `?limit=50&before=<id>`. For orders, use `beforeSeq`.

## Auth

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/auth/register` | `{ username, password }` | 201 `MeResponse`, and sets the cookie. The account starts with exactly $10,000.00 |
| POST | `/auth/login` | `{ username, password }` | `MeResponse`, and sets the cookie. The session rotates |
| POST | `/auth/logout` | – | 204 |
| GET | `/auth/me` | – | `MeResponse` or 401 |

Field rules:

* `username`: 3–32 characters, `[A-Za-z0-9_]`. Uniqueness is case-insensitive.
* `password`: 10–128 characters.

## Market data (public)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/market/status` | `{ open, marketHalt, epoch, serverTime }` |
| GET | `/securities?q=` | `{ securities: SecurityView[] }`, ordered by original rank. `q` searches ticker prefix or name |
| GET | `/securities/:ticker` | `{ security: SecurityDetailView }`, including historical notes |
| GET | `/securities/:ticker/book?depth=10` | `{ book: OrderBookView }`: best bid/ask, spread, aggregated levels, `bookVersion` |
| GET | `/securities/:ticker/trades?limit=&before=` | `{ trades: TradeView[] }`, newest first |
| GET | `/securities/:ticker/history?interval=trade\|1m\|5m\|15m\|1h\|1d&from=&to=&limit=` | Real executions only. `interval=trade` returns `{kind:'trade'}` points; any other interval returns OHLCV `{kind:'bar'}` points. Also returns `referencePriceCents` and `referencePriceKind`. An empty array means the security has never traded |
| GET | `/market/movers?limit=5` | `{ gainers, losers }` by change from reference (bps). Only traded securities appear |
| GET | `/leaderboard?limit=&offset=` | `{ entries: LeaderboardEntry[] }`: total value is cash plus holdings marked at last price (or reference). The market maker is excluded |

`SecurityView` fields worth knowing:

* `tradable` and `tradingBlockReason`, which is one of `MARKET_HALTED`, `STATUS_UNVERIFIED`, `SECURITY_SUSPENDED`, `SECURITY_UNLISTED`, `SECURITY_LISTING_HALTED`, `REFERENCE_PRICE_UNVERIFIED`, `SYMBOL_HALTED`.
* `displayPriceCents` and `displayPriceKind`:
  * `LAST_TRADE`
  * `REFERENCE_VERIFIED`
  * `REFERENCE_SIMULATED`: always label this one in the UI.
* `referencePriceKind`: `VERIFIED` or `SIMULATED`.

## Orders (authenticated)

`POST /orders` requires the header **`Idempotency-Key: <8-128 chars [A-Za-z0-9_-:.]>`**. Generate one UUID per user action and reuse it on retries.

```jsonc
{ "ticker": "SNIG", "side": "BUY", "type": "LIMIT",  "quantity": 10, "limitPriceCents": 1250 }
{ "ticker": "SNIG", "side": "BUY", "type": "MARKET", "quantity": 10, "maxSpendCents": 15000 }  // budget required
{ "ticker": "SNIG", "side": "SELL", "type": "MARKET", "quantity": 10 }
```

Responses are `PlaceOrderResponse { order, fills, replayed }`:

* **201**: accepted. `order.status` is one of:
  * `FILLED`
  * `OPEN` or `PARTIALLY_FILLED` (resting)
  * `CANCELLED`, when a market order's remainder or a self-trade-prevented remainder was cancelled; `cancelReason` says which.
* **422**: rejected and recorded. `order.rejectReason` is one of `INSUFFICIENT_FUNDS`, `INSUFFICIENT_SHARES`, `MARKET_HALTED`, `SYMBOL_HALTED`, `STATUS_UNVERIFIED`, and so on.
* **409** `IDEMPOTENCY_KEY_REUSED`: the same key was sent with a different body.

Other order routes:

| Method | Path | Notes |
| --- | --- | --- |
| DELETE | `/orders/:id` | Cancels an open order and releases its reservation. 409 `ORDER_NOT_OPEN` if the order already finished |
| GET | `/orders?status=open\|all&ticker=&limit=&beforeSeq=` | The user's orders |
| GET | `/orders/:id` | Owner only (404 for other users) |

## Account (authenticated)

| Method | Path | Response |
| --- | --- | --- |
| GET | `/portfolio` | `PortfolioView`: cash, reserved, available, holdings (quantity, reserved, available, mark, cost basis, unrealized/realized P&L), total value, total P&L vs $10,000, rank and number of ranked users, open orders |
| GET | `/account/trades` | `MyTradeView[]`: includes side, maker/taker, and notional |
| GET | `/account/ledger/cash` | Cash ledger entries: `INITIAL_GRANT`, `TRADE_BUY`, `TRADE_SELL` |
| GET | `/account/ledger/positions` | Position ledger entries |

## Admin (ADMIN role)

All routes are under `/admin`. Actions are audited.

| Method | Path | Body |
| --- | --- | --- |
| GET | `/admin/users?limit=&offset=` | |
| POST | `/admin/users` | `{ username, password, role? }` (account starts with $10,000) |
| PATCH | `/admin/users/:id` | `{ role?, status?: 'ACTIVE'\|'DISABLED', password? }`. Disabling revokes sessions and cancels open orders |
| POST | `/admin/market/halt`, `/admin/market/resume` | `{ reason }` |
| POST | `/admin/securities/:ticker/halt`, `/resume` | `{ reason }` |
| POST | `/admin/securities/:ticker/listing-status` | `{ status, reason, authorizationReference }`. This is the documented way to lift an original restriction |
| POST | `/admin/securities/:ticker/simulated-reference` | `{ referencePriceCents, activate, note, acknowledgement: "I UNDERSTAND THIS PRICE IS SIMULATED AND NOT ORIGINAL" }` |
| GET | `/admin/market-maker` | Market maker cash, inventory, and configs |
| PUT | `/admin/market-maker/:ticker` | `{ inventoryShares, askLevels:[{offsetBps,quantity}], bidLevels:[…], enabled?, note }` |
| POST | `/admin/market-maker/:ticker/open` | Issues inventory and places quotes, once per epoch |
| POST | `/admin/orders/:id/cancel` | |
| GET | `/admin/trades?ticker=&userId=`, `/admin/ledger/cash?userId=`, `/admin/ledger/positions?userId=`, `/admin/issuance`, `/admin/halts`, `/admin/audit-logs` | Inspection |
| GET | `/admin/integrity` | `{ ok, violations[], stats }` |
| POST | `/admin/simulation/reset` | `{ confirmation: "RESET THE AEZ STOCK EXCHANGE SIMULATION", password, reason }`. The market must be halted first |
| GET | `/admin/simulation/resets` | Reset history |

## Socket.IO

```ts
import { io } from 'socket.io-client';
const socket = io('http://localhost:4000', { withCredentials: true }); // the session cookie authenticates user events
socket.emit('subscribe', ['SNIG', 'JINK'], (ack) => console.log(ack.subscribed));
socket.on('trade', ({ eventId, ticker, trade }) => {});
socket.on('book',  ({ eventId, ticker, book }) => {});   // full depth snapshot; if bookVersion jumps, refetch
socket.on('price', ({ eventId, ticker, lastPriceCents, lastTradeAt }) => {});
socket.on('order', ({ eventId, order }) => {});          // only your own orders
socket.on('portfolio.changed', () => { /* refetch /portfolio */ });
socket.on('market.status', ({ open, reason }) => {});
socket.on('security.status', ({ ticker }) => { /* refetch security */ });
socket.on('market.reset', ({ epoch }) => { /* refetch everything */ });
```

Delivery is at-least-once, so de-duplicate by `eventId`. Typed event maps are `ServerToClientEvents` and `ClientToServerEvents` in `@aez/shared`.
