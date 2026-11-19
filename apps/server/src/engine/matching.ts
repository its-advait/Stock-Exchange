/**
 * AEZ central limit order book matching engine.
 *
 * Durable, PostgreSQL-backed, price-time priority CLOB. Every order placement or
 * cancellation is ONE database transaction; all effects (balances, holdings,
 * reservations, order states, executions, ledgers, last price, outbox events)
 * commit together or not at all.
 *
 * LOCK ORDER (deterministic, identical in every code path; see docs/ARCHITECTURE.md):
 *   0. idempotency_keys row (user, key)            -- placement only; private to the request
 *   1. market_state (id = 1)  FOR SHARE            -- halts/reset take FOR UPDATE
 *   2. securities (ticker)    FOR UPDATE           -- serializes ALL book mutation for a symbol
 *   3. cash_accounts          FOR UPDATE, ascending user_id
 *   4. holdings (ticker)      FOR UPDATE, ascending user_id
 *   5. orders rows (already exclusively ours because of lock 2)
 * A transaction never holds more than one securities lock (except reset, which
 * holds market_state exclusively, so nothing else can run).
 *
 * SELF-TRADE PREVENTION: "cancel incoming remainder". If, walking the book in
 * strict price-time order, the next eligible resting order belongs to the
 * incoming order's owner, matching STOPS. Fills already made stand; the incoming
 * order's unfilled remainder is cancelled (reason SELF_TRADE_PREVENTION). The
 * incoming order never skips past its own order to reach worse-priority
 * liquidity, and it never rests (which would leave a crossed book).
 */
import crypto from 'node:crypto';
import type { FillView, OrderView, PlaceOrderResponse } from '@aez/shared';
import type { Client, Pool } from '../db/pool.js';
import { withTx } from '../db/tx.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { num, toJson } from '../lib/json.js';
import { enqueueOutbox, rooms, type OutboxMessage } from '../lib/outbox.js';
import { ORDER_COLUMNS, orderView, tradeView, type OrderRow, type TradeRow } from '../lib/views.js';
import { getOrderBook } from './book.js';
import { tradingBlockReason } from './tradability.js';

export type Side = 'BUY' | 'SELL';
export type OrderKind = 'MARKET' | 'LIMIT';

export interface PlaceOrderInput {
  userId: string;
  ticker: string;
  side: Side;
  type: OrderKind;
  quantity: bigint;
  limitPriceCents?: bigint | null;
  maxSpendCents?: bigint | null;
  idempotencyKey: string;
}

export interface PlaceOrderOutcome {
  httpStatus: number;
  body: PlaceOrderResponse;
}

/** Test-only fault injection: called after all writes, before commit. */
export interface EngineHooks {
  beforeCommit?: (c: Client) => Promise<void> | void;
}

interface RestingOrder {
  id: string;
  userId: string;
  price: bigint;
  quantity: bigint;
  filled: bigint;
  seq: bigint;
}

interface PlannedFill {
  maker: RestingOrder;
  quantity: bigint;
  price: bigint;
}

type StopReason = 'SELF_TRADE_PREVENTION' | 'NO_LIQUIDITY' | 'MAX_SPEND_REACHED' | null;

const BOOK_BATCH = 200;
const MAX_BIGINT_PRICE = 9223372036854775807n;

/* ------------------------------------------------------------------------ */

export function requestHash(i: PlaceOrderInput): string {
  const canonical = toJson({
    ticker: i.ticker,
    side: i.side,
    type: i.type,
    quantity: i.quantity.toString(),
    limitPriceCents: i.limitPriceCents?.toString() ?? null,
    maxSpendCents: i.maxSpendCents?.toString() ?? null,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/** Place an order in its own transaction. */
export async function placeOrder(pool: Pool, input: PlaceOrderInput, hooks?: EngineHooks): Promise<PlaceOrderOutcome> {
  return withTx(pool, async (c) => {
    const out = await placeOrderInTx(c, input);
    await hooks?.beforeCommit?.(c);
    return out;
  });
}

/**
 * Place an order inside an existing transaction (used by the market-maker
 * opening routine so issuance + quotes are atomic).
 */
export async function placeOrderInTx(c: Client, input: PlaceOrderInput): Promise<PlaceOrderOutcome> {
  validateShape(input);
  const hash = requestHash(input);

  // 0. Idempotency. A concurrent duplicate blocks here on the PK until the first commits.
  const ins = await c.query(
    `INSERT INTO idempotency_keys (user_id, key, scope, request_hash) VALUES ($1, $2, 'PLACE_ORDER', $3)
     ON CONFLICT (user_id, key) DO NOTHING RETURNING key`,
    [input.userId, input.idempotencyKey, hash],
  );
  if (ins.rowCount === 0) {
    const ex = await c.query<{ request_hash: string; response_status: number | null; response_body: PlaceOrderResponse | null }>(
      `SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2`,
      [input.userId, input.idempotencyKey],
    );
    const row = ex.rows[0];
    if (!row || row.request_hash !== hash) {
      throw conflict('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request');
    }
    if (row.response_body === null || row.response_status === null) {
      throw conflict('IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed');
    }
    return { httpStatus: row.response_status, body: { ...row.response_body, replayed: true } };
  }

  // 1. Market state (shared lock) + market-wide halt.
  const ms = await c.query<{ current_epoch: number }>(`SELECT current_epoch FROM market_state WHERE id = 1 FOR SHARE`);
  const epoch = ms.rows[0]!.current_epoch;
  const marketHalted =
    (await c.query(`SELECT 1 FROM trading_halts WHERE scope = 'MARKET' AND ended_at IS NULL`)).rowCount! > 0;

  // 2. Symbol lock: serializes every book mutation for this ticker.
  const secRes = await c.query<{ ticker: string; status: TradabilityStatus; reference_price_cents: bigint | null }>(
    `SELECT ticker, status, reference_price_cents FROM securities WHERE ticker = $1 FOR UPDATE`,
    [input.ticker],
  );
  const sec = secRes.rows[0];
  if (!sec) throw notFound('Security');
  const symbolHalted =
    (await c.query(`SELECT 1 FROM trading_halts WHERE scope = 'SYMBOL' AND ticker = $1 AND ended_at IS NULL`, [input.ticker]))
      .rowCount! > 0;

  const blocked = tradingBlockReason(sec, symbolHalted, marketHalted);
  if (blocked) return reject(c, input, blocked);

  // 3. Plan the match purely from the (now frozen) book.
  const plan = await planMatch(c, input);

  // 4. Lock every involved account in ascending user_id order.
  const userIds = [...new Set([input.userId, ...plan.fills.map((f) => f.maker.userId)])];
  const cash = await lockCash(c, userIds);
  const hold = await lockHoldings(c, input.ticker, userIds);

  // 5. Validate the incoming order against the taker's AVAILABLE balances.
  const takerCash = cash.get(input.userId);
  const takerHold = hold.get(input.userId);
  if (!takerCash || !takerHold) throw new AppError(500, 'ACCOUNT_MISSING', 'Account not provisioned');
  if (input.side === 'BUY') {
    const required = input.type === 'LIMIT' ? input.quantity * input.limitPriceCents! : input.maxSpendCents!;
    if (takerCash.cash - takerCash.reserved < required) return reject(c, input, 'INSUFFICIENT_FUNDS');
  } else if (takerHold.qty - takerHold.reserved < input.quantity) {
    return reject(c, input, 'INSUFFICIENT_SHARES');
  }

  // 6. Compute the incoming order's final state.
  let filled = 0n;
  let notional = 0n;
  for (const f of plan.fills) {
    filled += f.quantity;
    notional += f.quantity * f.price;
  }
  const remaining = input.quantity - filled;
  let status: OrderView['status'];
  let cancelReason: string | null = null;
  let restReservedCents = 0n;
  let restReservedQty = 0n;
  if (remaining === 0n) {
    status = 'FILLED';
  } else if (input.type === 'MARKET' || plan.stop === 'SELF_TRADE_PREVENTION') {
    // Market orders never rest; STP cancels the incoming remainder.
    status = 'CANCELLED';
    cancelReason = plan.stop ?? 'NO_LIQUIDITY';
  } else {
    status = filled > 0n ? 'PARTIALLY_FILLED' : 'OPEN';
    if (input.side === 'BUY') restReservedCents = remaining * input.limitPriceCents!;
    else restReservedQty = remaining;
  }
  const isOpen = status === 'OPEN' || status === 'PARTIALLY_FILLED';

  const takerId = crypto.randomUUID();
  const takerRow = (
    await c.query<OrderRow>(
      `INSERT INTO orders (id, user_id, ticker, side, type, limit_price_cents, quantity, filled_quantity, max_spend_cents,
                           reserved_cents, reserved_quantity, filled_notional_cents, status, cancel_reason, idempotency_key, closed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CASE WHEN $16::boolean THEN NULL ELSE now() END)
       RETURNING ${ORDER_COLUMNS}`,
      [
        takerId,
        input.userId,
        input.ticker,
        input.side,
        input.type,
        input.limitPriceCents ?? null,
        input.quantity,
        filled,
        input.maxSpendCents ?? null,
        restReservedCents,
        restReservedQty,
        notional,
        status,
        cancelReason,
        input.idempotencyKey,
        isOpen,
      ],
    )
  ).rows[0]!;

  // 7. Apply fills.
  const outbox: OutboxMessage[] = [];
  const fillViews: FillView[] = [];
  const makerViews: OrderView[] = [];
  let lastPrice: bigint | null = null;
  let lastTradeAt: Date | null = null;
  for (const f of plan.fills) {
    const n = f.quantity * f.price;
    const maker = f.maker;
    const makerFilled = maker.filled + f.quantity;
    const makerStatus = makerFilled === maker.quantity ? 'FILLED' : 'PARTIALLY_FILLED';
    const makerSide: Side = input.side === 'BUY' ? 'SELL' : 'BUY';
    const makerRow = (
      await c.query<OrderRow>(
        `UPDATE orders SET
            filled_quantity = filled_quantity + $2,
            filled_notional_cents = filled_notional_cents + $3,
            reserved_cents = CASE WHEN side = 'BUY' THEN reserved_cents - $3 ELSE 0 END,
            reserved_quantity = CASE WHEN side = 'SELL' THEN reserved_quantity - $2 ELSE 0 END,
            status = $4::order_status,
            closed_at = CASE WHEN $4::order_status = 'FILLED' THEN now() ELSE NULL END,
            updated_at = now()
          WHERE id = $1 AND status IN ('OPEN', 'PARTIALLY_FILLED')
          RETURNING ${ORDER_COLUMNS}`,
        [maker.id, f.quantity, n, makerStatus],
      )
    ).rows[0];
    if (!makerRow) throw new AppError(500, 'BOOK_INCONSISTENT', 'Resting order changed during matching');
    makerViews.push(orderView(makerRow));

    const buyerId = input.side === 'BUY' ? input.userId : maker.userId;
    const sellerId = input.side === 'BUY' ? maker.userId : input.userId;
    const buyOrderId = input.side === 'BUY' ? takerId : maker.id;
    const sellOrderId = input.side === 'BUY' ? maker.id : takerId;

    // Average-cost basis removal (floor). Selling the whole position removes all basis.
    const sellerHoldPre = hold.get(sellerId)!;
    const removedBasis = (sellerHoldPre.basis * f.quantity) / sellerHoldPre.qty;
    const sellerRealized = n - removedBasis;

    const tradeRow = (
      await c.query<TradeRow>(
        `INSERT INTO trades (ticker, price_cents, quantity, buy_order_id, sell_order_id, buyer_id, seller_id,
                             maker_order_id, taker_order_id, aggressor_side, seller_realized_pnl_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, ticker, price_cents, quantity, aggressor_side, executed_at`,
        [input.ticker, f.price, f.quantity, buyOrderId, sellOrderId, buyerId, sellerId, maker.id, takerId, input.side, sellerRealized],
      )
    ).rows[0]!;
    await c.query(
      `INSERT INTO price_history (ticker, trade_id, price_cents, quantity, recorded_at) VALUES ($1, $2, $3, $4, $5)`,
      [input.ticker, tradeRow.id, f.price, f.quantity, tradeRow.executed_at],
    );

    // --- balances (in-memory over locked rows; flushed once below) ---
    const buyerCash = cash.get(buyerId)!;
    const sellerCash = cash.get(sellerId)!;
    const buyerHold = hold.get(buyerId)!;
    const sellerHold = hold.get(sellerId)!;

    buyerCash.cash -= n;
    if (makerSide === 'BUY') buyerCash.reserved -= n; // resting bid executes exactly at its own limit
    sellerCash.cash += n;

    buyerHold.qty += f.quantity;
    buyerHold.basis += n;
    sellerHold.basis -= removedBasis;
    sellerHold.realized += sellerRealized;
    sellerHold.qty -= f.quantity;
    if (makerSide === 'SELL') sellerHold.reserved -= f.quantity;
    buyerCash.dirty = sellerCash.dirty = buyerHold.dirty = sellerHold.dirty = true;

    await c.query(
      `INSERT INTO cash_ledger (user_id, amount_cents, balance_after_cents, reason, trade_id, order_id, epoch) VALUES
         ($1, $2, $3, 'TRADE_BUY', $4, $5, $9),
         ($6, $7, $8, 'TRADE_SELL', $4, $10, $9)`,
      [buyerId, -n, buyerCash.cash, tradeRow.id, buyOrderId, sellerId, n, sellerCash.cash, epoch, sellOrderId],
    );
    await c.query(
      `INSERT INTO position_ledger (user_id, ticker, quantity_delta, quantity_after, reason, trade_id, epoch) VALUES
         ($1, $2, $3, $4, 'TRADE_BUY', $5, $8),
         ($6, $2, $7, $9, 'TRADE_SELL', $5, $8)`,
      [buyerId, input.ticker, f.quantity, buyerHold.qty, tradeRow.id, sellerId, -f.quantity, epoch, sellerHold.qty],
    );

    lastPrice = f.price;
    lastTradeAt = tradeRow.executed_at;
    fillViews.push({ tradeId: num(tradeRow.id), priceCents: num(f.price), quantity: num(f.quantity), counterpartyOrderId: maker.id });
    outbox.push({ event: 'trade', room: rooms.ticker(input.ticker), payload: { ticker: input.ticker, trade: tradeView(tradeRow) } });
  }

  // 8. Taker reservation for the resting remainder.
  if (restReservedCents > 0n) {
    takerCash.reserved += restReservedCents;
    takerCash.dirty = true;
  }
  if (restReservedQty > 0n) {
    takerHold.reserved += restReservedQty;
    takerHold.dirty = true;
  }

  // 9. Flush balances (CHECK constraints are the last line of defense).
  for (const [userId, a] of cash) {
    if (!a.dirty) continue;
    await c.query(`UPDATE cash_accounts SET cash_cents = $2, reserved_cents = $3, updated_at = now() WHERE user_id = $1`, [
      userId,
      a.cash,
      a.reserved,
    ]);
  }
  for (const [userId, h] of hold) {
    if (!h.dirty) continue;
    await c.query(
      `UPDATE holdings SET quantity = $3, reserved_quantity = $4, cost_basis_cents = $5, realized_pnl_cents = $6, updated_at = now()
        WHERE user_id = $1 AND ticker = $2`,
      [userId, input.ticker, h.qty, h.reserved, h.basis, h.realized],
    );
  }

  // 10. Security: last traded price (only from genuine executions) + book version.
  const bookChanged = plan.fills.length > 0 || isOpen;
  if (bookChanged) {
    await c.query(
      `UPDATE securities SET
          last_price_cents = COALESCE($2, last_price_cents),
          last_trade_at = CASE WHEN $2::bigint IS NULL THEN last_trade_at ELSE now() END,
          book_version = book_version + 1,
          updated_at = now()
        WHERE ticker = $1`,
      [input.ticker, lastPrice],
    );
    const book = await getOrderBook(c, input.ticker, 10);
    outbox.push({ event: 'book', room: rooms.ticker(input.ticker), payload: { ticker: input.ticker, book } });
  }
  if (lastPrice !== null) {
    const p = { ticker: input.ticker, lastPriceCents: lastPrice, lastTradeAt: lastTradeAt!.toISOString() };
    outbox.push({ event: 'price', room: rooms.ticker(input.ticker), payload: p });
    outbox.push({ event: 'price', room: rooms.market, payload: p });
  }
  const takerView = orderView(takerRow);
  outbox.push({ event: 'order', room: rooms.user(input.userId), payload: { order: takerView } });
  for (const mv of makerViews) {
    const owner = plan.fills.find((f) => f.maker.id === mv.id)!.maker.userId;
    outbox.push({ event: 'order', room: rooms.user(owner), payload: { order: mv } });
  }
  for (const u of userIds) {
    if (cash.get(u)?.dirty || hold.get(u)?.dirty)
      outbox.push({ event: 'portfolio.changed', room: rooms.user(u), payload: { reason: 'ORDER_ACTIVITY' } });
  }
  await enqueueOutbox(c, outbox);

  const body: PlaceOrderResponse = { order: takerView, fills: fillViews, replayed: false };
  await storeIdempotentResponse(c, input, 201, body);
  return { httpStatus: 201, body };
}

type TradabilityStatus = 'ACTIVE' | 'HALTED' | 'SUSPENDED' | 'UNLISTED' | null;

/* --------------------------------- Cancel -------------------------------- */

export interface CancelInput {
  orderId: string;
  actorUserId: string;
  /** Admins may cancel any user's order. */
  actorIsAdmin?: boolean;
  reason?: string;
}

export async function cancelOrder(pool: Pool, input: CancelInput): Promise<OrderView> {
  return withTx(pool, (c) => cancelOrderInTx(c, input));
}

export async function cancelOrderInTx(c: Client, input: CancelInput): Promise<OrderView> {
  const pre = await c.query<{ ticker: string; user_id: string }>(`SELECT ticker, user_id FROM orders WHERE id = $1`, [
    input.orderId,
  ]);
  const o = pre.rows[0];
  if (!o || (o.user_id !== input.actorUserId && !input.actorIsAdmin)) throw notFound('Order');

  // Same lock order as placement. Cancels are allowed while halted.
  await c.query(`SELECT 1 FROM market_state WHERE id = 1 FOR SHARE`);
  await c.query(`SELECT 1 FROM securities WHERE ticker = $1 FOR UPDATE`, [o.ticker]);
  const ord = (await c.query<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1 FOR UPDATE`, [input.orderId])).rows[0]!;
  if (ord.status !== 'OPEN' && ord.status !== 'PARTIALLY_FILLED') {
    throw conflict('ORDER_NOT_OPEN', `Order is already ${ord.status}`, { order: orderView(ord) });
  }
  const cash = await lockCash(c, [ord.user_id]);
  const hold = await lockHoldings(c, ord.ticker, [ord.user_id]);
  const a = cash.get(ord.user_id)!;
  const h = hold.get(ord.user_id)!;
  if (ord.side === 'BUY') {
    await c.query(`UPDATE cash_accounts SET reserved_cents = $2, updated_at = now() WHERE user_id = $1`, [
      ord.user_id,
      a.reserved - ord.reserved_cents,
    ]);
  } else {
    await c.query(`UPDATE holdings SET reserved_quantity = $3, updated_at = now() WHERE user_id = $1 AND ticker = $2`, [
      ord.user_id,
      ord.ticker,
      h.reserved - ord.reserved_quantity,
    ]);
  }
  const updated = (
    await c.query<OrderRow>(
      `UPDATE orders SET status = 'CANCELLED', reserved_cents = 0, reserved_quantity = 0, cancel_reason = $2,
              closed_at = now(), updated_at = now()
        WHERE id = $1 RETURNING ${ORDER_COLUMNS}`,
      [ord.id, input.reason ?? 'USER_REQUESTED'],
    )
  ).rows[0]!;
  await c.query(`UPDATE securities SET book_version = book_version + 1, updated_at = now() WHERE ticker = $1`, [ord.ticker]);
  const book = await getOrderBook(c, ord.ticker, 10);
  const view = orderView(updated);
  await enqueueOutbox(c, [
    { event: 'book', room: rooms.ticker(ord.ticker), payload: { ticker: ord.ticker, book } },
    { event: 'order', room: rooms.user(ord.user_id), payload: { order: view } },
    { event: 'portfolio.changed', room: rooms.user(ord.user_id), payload: { reason: 'ORDER_CANCELLED' } },
  ]);
  return view;
}

/* -------------------------------- Helpers -------------------------------- */

function validateShape(i: PlaceOrderInput): void {
  const bad = (m: string) => new AppError(400, 'INVALID_ORDER', m);
  if (i.quantity <= 0n) throw bad('quantity must be a positive integer');
  if (i.type === 'LIMIT') {
    if (i.limitPriceCents == null || i.limitPriceCents <= 0n) throw bad('LIMIT orders require a positive limit price');
    if (i.maxSpendCents != null) throw bad('maxSpendCents applies to MARKET BUY only');
  } else {
    if (i.limitPriceCents != null) throw bad('MARKET orders must not have a limit price');
    if (i.side === 'BUY' && (i.maxSpendCents == null || i.maxSpendCents <= 0n))
      throw bad('MARKET BUY requires a positive maxSpendCents budget');
    if (i.side === 'SELL' && i.maxSpendCents != null) throw bad('maxSpendCents applies to MARKET BUY only');
  }
}

/**
 * Walk the opposite side of the book in strict price-time priority and decide
 * the fills. Reads only; the caller holds the symbol lock so the book cannot
 * change underneath us.
 */
async function planMatch(c: Client, i: PlaceOrderInput): Promise<{ fills: PlannedFill[]; stop: StopReason }> {
  const fills: PlannedFill[] = [];
  let left = i.quantity;
  let budget = i.type === 'MARKET' && i.side === 'BUY' ? i.maxSpendCents! : null;
  const limit = i.type === 'LIMIT' ? i.limitPriceCents! : null;
  let cursorPrice = i.side === 'BUY' ? 0n : MAX_BIGINT_PRICE;
  let cursorSeq = 0n;

  const sql =
    i.side === 'BUY'
      ? `SELECT id, user_id, limit_price_cents, quantity, filled_quantity, seq FROM orders
          WHERE ticker = $1 AND side = 'SELL' AND status IN ('OPEN', 'PARTIALLY_FILLED')
            AND ($2::bigint IS NULL OR limit_price_cents <= $2)
            AND (limit_price_cents > $3 OR (limit_price_cents = $3 AND seq > $4))
          ORDER BY limit_price_cents ASC, seq ASC LIMIT $5`
      : `SELECT id, user_id, limit_price_cents, quantity, filled_quantity, seq FROM orders
          WHERE ticker = $1 AND side = 'BUY' AND status IN ('OPEN', 'PARTIALLY_FILLED')
            AND ($2::bigint IS NULL OR limit_price_cents >= $2)
            AND (limit_price_cents < $3 OR (limit_price_cents = $3 AND seq > $4))
          ORDER BY limit_price_cents DESC NULLS LAST, seq ASC LIMIT $5`;

  for (;;) {
    const res = await c.query<{
      id: string;
      user_id: string;
      limit_price_cents: bigint;
      quantity: bigint;
      filled_quantity: bigint;
      seq: bigint;
    }>(sql, [i.ticker, limit, cursorPrice, cursorSeq, BOOK_BATCH]);
    if (res.rows.length === 0) return { fills, stop: 'NO_LIQUIDITY' };
    for (const r of res.rows) {
      const maker: RestingOrder = {
        id: r.id,
        userId: r.user_id,
        price: r.limit_price_cents,
        quantity: r.quantity,
        filled: r.filled_quantity,
        seq: r.seq,
      };
      cursorPrice = maker.price;
      cursorSeq = maker.seq;
      if (maker.userId === i.userId) return { fills, stop: 'SELF_TRADE_PREVENTION' };
      let q = maker.quantity - maker.filled;
      if (q > left) q = left;
      let budgetBound = false;
      if (budget !== null) {
        const affordable = budget / maker.price;
        if (affordable < q) {
          q = affordable;
          budgetBound = true;
        }
        if (q === 0n) return { fills, stop: 'MAX_SPEND_REACHED' };
        budget -= q * maker.price;
      }
      fills.push({ maker, quantity: q, price: maker.price });
      left -= q;
      if (left === 0n) return { fills, stop: null };
      // Asks are ascending, so once the budget binds no later order is affordable either.
      if (budgetBound) return { fills, stop: 'MAX_SPEND_REACHED' };
    }
    if (res.rows.length < BOOK_BATCH) return { fills, stop: 'NO_LIQUIDITY' };
  }
}

interface CashState {
  cash: bigint;
  reserved: bigint;
  dirty: boolean;
}
interface HoldState {
  qty: bigint;
  reserved: bigint;
  basis: bigint;
  realized: bigint;
  dirty: boolean;
}

async function lockCash(c: Client, userIds: string[]): Promise<Map<string, CashState>> {
  const res = await c.query<{ user_id: string; cash_cents: bigint; reserved_cents: bigint }>(
    `SELECT user_id, cash_cents, reserved_cents FROM cash_accounts
      WHERE user_id = ANY($1::uuid[]) ORDER BY user_id FOR UPDATE`,
    [userIds],
  );
  return new Map(res.rows.map((r) => [r.user_id, { cash: r.cash_cents, reserved: r.reserved_cents, dirty: false }]));
}

async function lockHoldings(c: Client, ticker: string, userIds: string[]): Promise<Map<string, HoldState>> {
  await c.query(
    `INSERT INTO holdings (user_id, ticker)
     SELECT u, $2 FROM unnest($1::uuid[]) AS u ORDER BY u
     ON CONFLICT (user_id, ticker) DO NOTHING`,
    [userIds, ticker],
  );
  const res = await c.query<{
    user_id: string;
    quantity: bigint;
    reserved_quantity: bigint;
    cost_basis_cents: bigint;
    realized_pnl_cents: bigint;
  }>(
    `SELECT user_id, quantity, reserved_quantity, cost_basis_cents, realized_pnl_cents FROM holdings
      WHERE ticker = $2 AND user_id = ANY($1::uuid[]) ORDER BY user_id FOR UPDATE`,
    [userIds, ticker],
  );
  return new Map(
    res.rows.map((r) => [
      r.user_id,
      { qty: r.quantity, reserved: r.reserved_quantity, basis: r.cost_basis_cents, realized: r.realized_pnl_cents, dirty: false },
    ]),
  );
}

async function reject(c: Client, input: PlaceOrderInput, reason: string): Promise<PlaceOrderOutcome> {
  const row = (
    await c.query<OrderRow>(
      `INSERT INTO orders (user_id, ticker, side, type, limit_price_cents, quantity, max_spend_cents, status, reject_reason,
                           idempotency_key, closed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'REJECTED', $8, $9, now())
       RETURNING ${ORDER_COLUMNS}`,
      [
        input.userId,
        input.ticker,
        input.side,
        input.type,
        input.limitPriceCents ?? null,
        input.quantity,
        input.maxSpendCents ?? null,
        reason,
        input.idempotencyKey,
      ],
    )
  ).rows[0]!;
  const view = orderView(row);
  await enqueueOutbox(c, [{ event: 'order', room: rooms.user(input.userId), payload: { order: view } }]);
  const body: PlaceOrderResponse = { order: view, fills: [], replayed: false };
  await storeIdempotentResponse(c, input, 422, body);
  return { httpStatus: 422, body };
}

async function storeIdempotentResponse(c: Client, input: PlaceOrderInput, status: number, body: PlaceOrderResponse) {
  await c.query(`UPDATE idempotency_keys SET response_status = $3, response_body = $4::jsonb WHERE user_id = $1 AND key = $2`, [
    input.userId,
    input.idempotencyKey,
    status,
    toJson(body),
  ]);
}
