import type { HoldingView, LeaderboardEntry, MyTradeView, OrderView, PortfolioView } from '@aez/shared';
import type { Queryable } from '../db/pool.js';
import { notFound } from '../lib/errors.js';
import { iso, num } from '../lib/json.js';
import { ORDER_COLUMNS, orderView, type OrderRow } from '../lib/views.js';
import { dayStartValue } from './insights.js';

/** Mark price = last traded price, else reference price (labeled). */
const VALUATION_CTE = `
  WITH vals AS (
    SELECT u.id AS user_id, u.username, u.created_at, c.cash_cents,
           COALESCE(SUM(h.quantity * COALESCE(s.last_price_cents, s.reference_price_cents, 0)), 0)::bigint AS holdings_value
      FROM users u
      JOIN cash_accounts c ON c.user_id = u.id
      LEFT JOIN holdings h ON h.user_id = u.id AND h.quantity > 0
      LEFT JOIN securities s ON s.ticker = h.ticker
     WHERE u.account_type = 'HUMAN' AND u.role = 'USER' AND u.status = 'ACTIVE'
     GROUP BY u.id, u.username, u.created_at, c.cash_cents
  ), ranked AS (
    SELECT *, (cash_cents + holdings_value) AS total_value,
           RANK() OVER (ORDER BY cash_cents + holdings_value DESC) AS rank,
           COUNT(*) OVER () AS ranked_users
      FROM vals
  )`;

export async function leaderboard(q: Queryable, startingCash: bigint, limit: number, offset = 0): Promise<LeaderboardEntry[]> {
  const r = await q.query<{
    user_id: string;
    username: string;
    cash_cents: bigint;
    holdings_value: bigint;
    total_value: bigint;
    rank: bigint;
  }>(`${VALUATION_CTE} SELECT * FROM ranked ORDER BY total_value DESC, created_at ASC, user_id LIMIT $1 OFFSET $2`, [limit, offset]);
  return r.rows.map((x) => ({
    rank: num(x.rank),
    userId: x.user_id,
    username: x.username,
    cashCents: num(x.cash_cents),
    holdingsValueCents: num(x.holdings_value),
    totalValueCents: num(x.total_value),
    pnlCents: num(x.total_value - startingCash),
  }));
}

export async function portfolio(q: Queryable, userId: string, startingCash: bigint): Promise<PortfolioView> {
  const [acct, hold, open, rank, dayStart] = await Promise.all([
    q.query<{ cash_cents: bigint; reserved_cents: bigint }>(`SELECT cash_cents, reserved_cents FROM cash_accounts WHERE user_id = $1`, [
      userId,
    ]),
    q.query<{
      ticker: string;
      name: string;
      quantity: bigint;
      reserved_quantity: bigint;
      cost_basis_cents: bigint;
      realized_pnl_cents: bigint;
      last_price_cents: bigint | null;
      reference_price_cents: bigint | null;
      reference_price_source: string | null;
    }>(
      `SELECT h.ticker, s.name, h.quantity, h.reserved_quantity, h.cost_basis_cents, h.realized_pnl_cents,
              s.last_price_cents, s.reference_price_cents, s.reference_price_source
         FROM holdings h JOIN securities s ON s.ticker = h.ticker
        WHERE h.user_id = $1 AND (h.quantity > 0 OR h.realized_pnl_cents <> 0)
        ORDER BY s.original_rank`,
      [userId],
    ),
    q.query<OrderRow>(
      `SELECT ${ORDER_COLUMNS} FROM orders WHERE user_id = $1 AND status IN ('OPEN', 'PARTIALLY_FILLED') ORDER BY seq DESC`,
      [userId],
    ),
    q.query<{ rank: bigint; ranked_users: bigint }>(`${VALUATION_CTE} SELECT rank, ranked_users FROM ranked WHERE user_id = $1`, [userId]),
    dayStartValue(q, userId),
  ]);
  const a = acct.rows[0];
  if (!a) throw notFound('Account');

  let holdingsValue = 0n;
  let realized = 0n;
  let unrealized = 0n;
  const holdings: HoldingView[] = hold.rows.map((h) => {
    const mark = h.last_price_cents ?? h.reference_price_cents;
    const kind =
      h.last_price_cents !== null
        ? ('LAST_TRADE' as const)
        : h.reference_price_cents !== null
          ? h.reference_price_source === 'ADMIN_SIMULATION'
            ? ('REFERENCE_SIMULATED' as const)
            : ('REFERENCE_VERIFIED' as const)
          : null;
    const mv = h.quantity * (mark ?? 0n);
    const upnl = h.quantity > 0n ? mv - h.cost_basis_cents : 0n;
    holdingsValue += mv;
    realized += h.realized_pnl_cents;
    unrealized += upnl;
    return {
      ticker: h.ticker,
      name: h.name,
      quantity: num(h.quantity),
      reservedQuantity: num(h.reserved_quantity),
      availableQuantity: num(h.quantity - h.reserved_quantity),
      markPriceCents: num(mark),
      markPriceKind: kind,
      marketValueCents: num(mv),
      costBasisCents: num(h.cost_basis_cents),
      unrealizedPnlCents: num(upnl),
      realizedPnlCents: num(h.realized_pnl_cents),
    };
  });
  const total = a.cash_cents + holdingsValue;
  return {
    cashCents: num(a.cash_cents),
    reservedCashCents: num(a.reserved_cents),
    availableCashCents: num(a.cash_cents - a.reserved_cents),
    holdingsValueCents: num(holdingsValue),
    totalValueCents: num(total),
    startingCashCents: num(startingCash),
    totalPnlCents: num(total - startingCash),
    realizedPnlCents: num(realized),
    unrealizedPnlCents: num(unrealized),
    rank: rank.rows[0] ? num(rank.rows[0].rank) : null,
    rankedUsers: rank.rows[0] ? num(rank.rows[0].ranked_users) : 0,
    dayStartValueCents: num(dayStart),
    dayChangeCents: num(total - dayStart),
    holdings,
    openOrders: open.rows.map(orderView),
  };
}

export async function listOrders(
  q: Queryable,
  userId: string,
  opts: { status: 'open' | 'all'; ticker?: string; limit: number; beforeSeq?: number },
): Promise<OrderView[]> {
  const r = await q.query<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders
      WHERE user_id = $1
        AND ($2::boolean = false OR status IN ('OPEN', 'PARTIALLY_FILLED'))
        AND ($3::text IS NULL OR ticker = $3)
        AND ($5::bigint IS NULL OR seq < $5)
      ORDER BY seq DESC LIMIT $4`,
    [userId, opts.status === 'open', opts.ticker ?? null, opts.limit, opts.beforeSeq ?? null],
  );
  return r.rows.map(orderView);
}

export async function getOrder(q: Queryable, userId: string, orderId: string, isAdmin = false): Promise<OrderView> {
  const r = await q.query<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1`, [orderId]);
  const o = r.rows[0];
  if (!o || (o.user_id !== userId && !isAdmin)) throw notFound('Order');
  return orderView(o);
}

export async function myTrades(q: Queryable, userId: string, limit: number, beforeId?: number): Promise<MyTradeView[]> {
  const r = await q.query<{
    id: bigint;
    ticker: string;
    price_cents: bigint;
    quantity: bigint;
    aggressor_side: 'BUY' | 'SELL';
    executed_at: Date;
    buyer_id: string;
    buy_order_id: string;
    sell_order_id: string;
    maker_order_id: string;
  }>(
    `SELECT * FROM (
       SELECT id, ticker, price_cents, quantity, aggressor_side, executed_at, buyer_id, buy_order_id, sell_order_id, maker_order_id
         FROM trades WHERE buyer_id = $1 AND ($3::bigint IS NULL OR id < $3)
       UNION ALL
       SELECT id, ticker, price_cents, quantity, aggressor_side, executed_at, buyer_id, buy_order_id, sell_order_id, maker_order_id
         FROM trades WHERE seller_id = $1 AND ($3::bigint IS NULL OR id < $3)
     ) t ORDER BY id DESC LIMIT $2`,
    [userId, limit, beforeId ?? null],
  );
  return r.rows.map((t) => {
    const side = t.buyer_id === userId ? ('BUY' as const) : ('SELL' as const);
    const orderId = side === 'BUY' ? t.buy_order_id : t.sell_order_id;
    return {
      id: num(t.id),
      ticker: t.ticker,
      priceCents: num(t.price_cents),
      quantity: num(t.quantity),
      aggressorSide: t.aggressor_side,
      executedAt: iso(t.executed_at)!,
      side,
      orderId,
      liquidity: t.maker_order_id === orderId ? ('MAKER' as const) : ('TAKER' as const),
      notionalCents: num(t.price_cents * t.quantity),
    };
  });
}

export async function cashLedgerFor(q: Queryable, userId: string | null, limit: number, beforeId?: number) {
  const r = await q.query<{
    id: bigint;
    user_id: string;
    amount_cents: bigint;
    balance_after_cents: bigint;
    reason: string;
    trade_id: bigint | null;
    order_id: string | null;
    epoch: number;
    created_at: Date;
  }>(
    `SELECT id, user_id, amount_cents, balance_after_cents, reason, trade_id, order_id, epoch, created_at FROM cash_ledger
      WHERE ($1::uuid IS NULL OR user_id = $1) AND ($3::bigint IS NULL OR id < $3) ORDER BY id DESC LIMIT $2`,
    [userId, limit, beforeId ?? null],
  );
  return r.rows.map((e) => ({
    id: num(e.id),
    userId: e.user_id,
    amountCents: num(e.amount_cents),
    balanceAfterCents: num(e.balance_after_cents),
    reason: e.reason,
    tradeId: num(e.trade_id),
    orderId: e.order_id,
    epoch: e.epoch,
    createdAt: iso(e.created_at)!,
  }));
}

export async function positionLedgerFor(q: Queryable, userId: string | null, limit: number, beforeId?: number) {
  const r = await q.query<{
    id: bigint;
    user_id: string;
    ticker: string;
    quantity_delta: bigint;
    quantity_after: bigint;
    reason: string;
    trade_id: bigint | null;
    issuance_id: bigint | null;
    epoch: number;
    created_at: Date;
  }>(
    `SELECT id, user_id, ticker, quantity_delta, quantity_after, reason, trade_id, issuance_id, epoch, created_at FROM position_ledger
      WHERE ($1::uuid IS NULL OR user_id = $1) AND ($3::bigint IS NULL OR id < $3) ORDER BY id DESC LIMIT $2`,
    [userId, limit, beforeId ?? null],
  );
  return r.rows.map((e) => ({
    id: num(e.id),
    userId: e.user_id,
    ticker: e.ticker,
    quantityDelta: num(e.quantity_delta),
    quantityAfter: num(e.quantity_after),
    reason: e.reason,
    tradeId: num(e.trade_id),
    issuanceId: num(e.issuance_id),
    epoch: e.epoch,
    createdAt: iso(e.created_at)!,
  }));
}
