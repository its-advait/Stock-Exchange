/**
 * Read-only analytics for the UI: portfolio value history, leaderboard boards and
 * public trader summaries. Everything is derived from the ledgers, trades and
 * price history. Nothing is estimated or synthesized.
 */
import type {
  ActivityRow,
  BigTradeRow,
  LeaderRow,
  LeaderboardBoardsView,
  PortfolioHistoryView,
  TraderProfileView,
} from '@aez/shared';
import type { Queryable } from '../db/pool.js';
import { notFound } from '../lib/errors.js';
import { iso, num } from '../lib/json.js';

const RANGE_INTERVAL: Record<PortfolioHistoryView['range'], string | null> = {
  '1D': '1 day',
  '1W': '7 days',
  '1M': '30 days',
  ALL: null,
};

/**
 * Account value at each timestamp: cash from the last cash-ledger balance at or
 * before t, plus each position's last ledger quantity at or before t, marked at
 * the last execution at or before t (else the security's reference price).
 */
async function valuesAt(q: Queryable, userId: string, times: Date[]): Promise<{ at: Date; cash: bigint; value: bigint }[]> {
  const r = await q.query<{ at: Date; cash: bigint; holdings: bigint }>(
    `WITH ts AS (SELECT unnest($2::timestamptz[]) AS at),
          tickers AS (SELECT DISTINCT ticker FROM position_ledger WHERE user_id = $1)
     SELECT ts.at,
            COALESCE((SELECT cl.balance_after_cents FROM cash_ledger cl
                       WHERE cl.user_id = $1 AND cl.created_at <= ts.at ORDER BY cl.id DESC LIMIT 1), 0)::bigint AS cash,
            COALESCE((SELECT SUM(pq.qty * COALESCE(pp.px, s.reference_price_cents, 0))
                        FROM tickers tk
                        JOIN securities s ON s.ticker = tk.ticker
                        CROSS JOIN LATERAL (SELECT pl.quantity_after AS qty FROM position_ledger pl
                                             WHERE pl.user_id = $1 AND pl.ticker = tk.ticker AND pl.created_at <= ts.at
                                             ORDER BY pl.id DESC LIMIT 1) pq
                        LEFT JOIN LATERAL (SELECT ph.price_cents AS px FROM price_history ph
                                            WHERE ph.ticker = tk.ticker AND ph.recorded_at <= ts.at
                                            ORDER BY ph.recorded_at DESC, ph.id DESC LIMIT 1) pp ON true), 0)::bigint AS holdings
       FROM ts ORDER BY ts.at`,
    [userId, times.map((t) => t.toISOString())],
  );
  return r.rows.map((x) => ({ at: x.at, cash: x.cash, value: x.cash + x.holdings }));
}

/** First moment the account had a balance in the current epoch (account creation or last reset). */
async function accountStart(q: Queryable, userId: string): Promise<Date | null> {
  const r = await q.query<{ at: Date | null }>(`SELECT date_trunc('milliseconds', MIN(created_at)) + interval '1 millisecond' AS at FROM cash_ledger WHERE user_id = $1`, [userId]);
  return r.rows[0]?.at ?? null;
}

export async function portfolioHistory(
  q: Queryable,
  userId: string,
  range: PortfolioHistoryView['range'],
  startingCash: bigint,
  buckets = 120,
): Promise<PortfolioHistoryView> {
  const startAcct = await accountStart(q, userId);
  const now = new Date((await q.query<{ now: Date }>(`SELECT date_trunc('milliseconds', now()) + interval '1 millisecond' AS now`)).rows[0]!.now);
  if (!startAcct) return { range, startingCashCents: num(startingCash), points: [] };
  const interval = RANGE_INTERVAL[range];
  let start = startAcct;
  if (interval) {
    const r = await q.query<{ t: Date }>(`SELECT now() - $1::interval AS t`, [interval]);
    if (r.rows[0]!.t > start) start = r.rows[0]!.t;
  }
  const span = now.getTime() - start.getTime();
  const times: Date[] = [];
  for (let i = 0; i <= buckets; i++) times.push(new Date(start.getTime() + Math.floor((span * i) / buckets)));
  // JS Dates carry milliseconds, Postgres microseconds: every boundary is rounded UP to the next
  // millisecond so a ledger row is never excluded from the instant it was written.
  // Also include the exact moments of this user's own executions inside the window, so steps are precise.
  const ev = await q.query<{ at: Date }>(
    `SELECT DISTINCT date_trunc('milliseconds', created_at) + interval '1 millisecond' AS at FROM cash_ledger WHERE user_id = $1 AND created_at > $2 AND created_at < $3 ORDER BY 1 DESC LIMIT 500`,
    [userId, start, now],
  );
  for (const e of ev.rows) times.push(e.at);
  times.sort((a, b) => a.getTime() - b.getTime());
  const dedup = times.filter((t, i) => i === 0 || t.getTime() !== times[i - 1]!.getTime());
  const rows = await valuesAt(q, userId, dedup);
  return {
    range,
    startingCashCents: num(startingCash),
    points: rows.map((p) => ({ at: iso(p.at)!, valueCents: num(p.value), cashCents: num(p.cash) })),
  };
}

/** Account value 24h ago (or at account start if newer). */
export async function dayStartValue(q: Queryable, userId: string): Promise<bigint> {
  const startAcct = await accountStart(q, userId);
  if (!startAcct) return 0n;
  const r = await q.query<{ t: Date }>(`SELECT GREATEST(now() - interval '24 hours', $1::timestamptz) AS t`, [startAcct]);
  const [v] = await valuesAt(q, userId, [r.rows[0]!.t]);
  return v?.value ?? 0n;
}

/* ------------------------------ Leaderboards ------------------------------ */

const VALUES_CTE = `
  WITH vals AS (
    SELECT u.id AS user_id, u.username, u.created_at, c.cash_cents,
           COALESCE(SUM(h.quantity * COALESCE(s.last_price_cents, s.reference_price_cents, 0)), 0)::bigint AS holdings_value
      FROM users u
      JOIN cash_accounts c ON c.user_id = u.id
      LEFT JOIN holdings h ON h.user_id = u.id AND h.quantity > 0
      LEFT JOIN securities s ON s.ticker = h.ticker
     WHERE u.account_type = 'HUMAN' AND u.status = 'ACTIVE'
     GROUP BY u.id, u.username, u.created_at, c.cash_cents
  ), ranked AS (
    SELECT *, (cash_cents + holdings_value) AS total_value,
           RANK() OVER (ORDER BY cash_cents + holdings_value DESC) AS rank,
           COUNT(*) OVER () AS ranked_users
      FROM vals
  )`;

type RankedRow = { user_id: string; username: string; total_value: bigint; rank: bigint; ranked_users: bigint };

function leaderRow(r: RankedRow, startingCash: bigint): LeaderRow {
  const pnl = r.total_value - startingCash;
  return {
    rank: num(r.rank),
    userId: r.user_id,
    username: r.username,
    totalValueCents: num(r.total_value),
    pnlCents: num(pnl),
    returnBps: startingCash > 0n ? num((pnl * 10000n) / startingCash) : 0,
  };
}

type BigTradeDbRow = {
  id: bigint;
  seller_id: string;
  username: string;
  ticker: string;
  quantity: bigint;
  price_cents: bigint;
  seller_realized_pnl_cents: bigint;
  executed_at: Date;
};

function bigTrade(r: BigTradeDbRow): BigTradeRow {
  return {
    tradeId: num(r.id),
    userId: r.seller_id,
    username: r.username,
    ticker: r.ticker,
    quantity: num(r.quantity),
    priceCents: num(r.price_cents),
    realizedPnlCents: num(r.seller_realized_pnl_cents),
    executedAt: iso(r.executed_at)!,
  };
}

const BIG_TRADE_SQL = (dir: 'DESC' | 'ASC', cmp: '>' | '<') => `
  SELECT t.id, t.seller_id, u.username, t.ticker, t.quantity, t.price_cents, t.seller_realized_pnl_cents, t.executed_at
    FROM trades t JOIN users u ON u.id = t.seller_id
   WHERE u.account_type = 'HUMAN' AND u.status = 'ACTIVE'
     AND t.seller_realized_pnl_cents IS NOT NULL AND t.seller_realized_pnl_cents ${cmp} 0
     AND ($2::uuid IS NULL OR t.seller_id = $2)
   ORDER BY t.seller_realized_pnl_cents ${dir}, t.id ASC LIMIT $1`;

export async function leaderboardBoards(q: Queryable, startingCash: bigint, limit: number): Promise<LeaderboardBoardsView> {
  const [top, bottom, active, wins, losses] = await Promise.all([
    q.query<RankedRow>(`${VALUES_CTE} SELECT * FROM ranked ORDER BY total_value DESC, created_at ASC, user_id LIMIT $1`, [limit]),
    q.query<RankedRow>(`${VALUES_CTE} SELECT * FROM ranked ORDER BY total_value ASC, created_at DESC, user_id LIMIT $1`, [limit]),
    q.query<{ user_id: string; username: string; trades: bigint; shares: bigint; notional: bigint }>(
      `SELECT u.id AS user_id, u.username, COUNT(*)::bigint AS trades, SUM(x.quantity)::bigint AS shares,
              SUM(x.quantity * x.price_cents)::bigint AS notional
         FROM (SELECT buyer_id AS uid, quantity, price_cents FROM trades
               UNION ALL SELECT seller_id, quantity, price_cents FROM trades) x
         JOIN users u ON u.id = x.uid
        WHERE u.account_type = 'HUMAN' AND u.status = 'ACTIVE'
        GROUP BY u.id, u.username
        ORDER BY trades DESC, notional DESC, u.username LIMIT $1`,
      [limit],
    ),
    q.query<BigTradeDbRow>(BIG_TRADE_SQL('DESC', '>'), [limit, null]),
    q.query<BigTradeDbRow>(BIG_TRADE_SQL('ASC', '<'), [limit, null]),
  ]);
  const richest = top.rows.map((r) => leaderRow(r, startingCash));
  const mostActive: ActivityRow[] = active.rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    trades: num(r.trades),
    sharesTraded: num(r.shares),
    notionalCents: num(r.notional),
  }));
  return {
    rankedUsers: top.rows[0] ? num(top.rows[0].ranked_users) : 0,
    startingCashCents: num(startingCash),
    topTrader: richest[0] ?? null,
    richest,
    poorest: bottom.rows.map((r) => leaderRow(r, startingCash)),
    // Every account starts with the same cash, so profit and return order identically to total value.
    highestProfit: richest,
    highestReturn: richest,
    mostActive,
    biggestWins: wins.rows.map(bigTrade),
    biggestLosses: losses.rows.map(bigTrade),
  };
}

/** Public summary: no cash balance breakdown beyond the leaderboard, no orders, no share counts. */
export async function traderProfile(q: Queryable, username: string, startingCash: bigint): Promise<TraderProfileView> {
  const u = await q.query<{ id: string; username: string; created_at: Date }>(
    `SELECT id, username, created_at FROM users WHERE lower(username) = lower($1) AND account_type = 'HUMAN' AND status = 'ACTIVE'`,
    [username],
  );
  const user = u.rows[0];
  if (!user) throw notFound('Trader');
  const [ranked, comp, stats, win] = await Promise.all([
    q.query<RankedRow & { cash_cents: bigint }>(`${VALUES_CTE} SELECT * FROM ranked WHERE user_id = $1`, [user.id]),
    q.query<{ ticker: string; value: bigint }>(
      `SELECT h.ticker, (h.quantity * COALESCE(s.last_price_cents, s.reference_price_cents, 0))::bigint AS value
         FROM holdings h JOIN securities s ON s.ticker = h.ticker
        WHERE h.user_id = $1 AND h.quantity > 0 ORDER BY value DESC, h.ticker`,
      [user.id],
    ),
    q.query<{ trades: bigint; realized: bigint }>(
      `SELECT (SELECT COUNT(*) FROM trades WHERE buyer_id = $1 OR seller_id = $1)::bigint AS trades,
              (SELECT COALESCE(SUM(realized_pnl_cents), 0) FROM holdings WHERE user_id = $1)::bigint AS realized`,
      [user.id],
    ),
    q.query<BigTradeDbRow>(BIG_TRADE_SQL('DESC', '>'), [1, user.id]),
  ]);
  const r = ranked.rows[0];
  const total = r?.total_value ?? 0n;
  const pnl = total - startingCash;
  const composition: { ticker: string; weightBps: number }[] = [];
  if (total > 0n) {
    for (const c of comp.rows) if (c.value > 0n) composition.push({ ticker: c.ticker, weightBps: num((c.value * 10000n) / total) });
    if (r && r.cash_cents > 0n) composition.push({ ticker: 'CASH', weightBps: num((r.cash_cents * 10000n) / total) });
  }
  return {
    username: user.username,
    joinedAt: iso(user.created_at)!,
    rank: r ? num(r.rank) : null,
    rankedUsers: r ? num(r.ranked_users) : 0,
    totalValueCents: num(total),
    pnlCents: num(pnl),
    returnBps: startingCash > 0n ? num((pnl * 10000n) / startingCash) : 0,
    trades: num(stats.rows[0]!.trades),
    realizedPnlCents: num(stats.rows[0]!.realized),
    composition,
    biggestWin: win.rows[0] ? bigTrade(win.rows[0]) : null,
  };
}
