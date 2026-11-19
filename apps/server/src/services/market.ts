import type { MarketStatusView, SecurityDetailView, SecurityView, TradeView } from '@aez/shared';
import type { Queryable } from '../db/pool.js';
import { tradingBlockReason } from '../engine/tradability.js';
import { notFound } from '../lib/errors.js';
import { iso, num } from '../lib/json.js';
import { tradeView, type TradeRow } from '../lib/views.js';

interface SecurityRow {
  ticker: string;
  name: string;
  original_rank: number;
  status: SecurityView['listingStatus'];
  reference_price_cents: bigint | null;
  reference_price_source: 'VERIFIED_IMPORT' | 'ADMIN_AUTHORIZED' | 'ADMIN_SIMULATION' | null;
  last_price_cents: bigint | null;
  last_trade_at: Date | null;
  description: string;
  image_url: string | null;
  news: string | null;
  background: string | null;
  trading_restriction: string | null;
  book_version: bigint;
  symbol_halted: boolean;
  best_bid: bigint | null;
  best_ask: bigint | null;
  volume_24h: bigint;
}

const SECURITY_SELECT = `
  SELECT s.ticker, s.name, s.original_rank, s.status, s.reference_price_cents, s.reference_price_source,
         s.last_price_cents, s.last_trade_at, s.description, s.image_url, s.news, s.background,
         s.trading_restriction, s.book_version,
         EXISTS (SELECT 1 FROM trading_halts h WHERE h.scope = 'SYMBOL' AND h.ticker = s.ticker AND h.ended_at IS NULL) AS symbol_halted,
         (SELECT o.limit_price_cents FROM orders o
           WHERE o.ticker = s.ticker AND o.side = 'BUY' AND o.status IN ('OPEN', 'PARTIALLY_FILLED')
           ORDER BY o.limit_price_cents DESC NULLS LAST LIMIT 1) AS best_bid,
         (SELECT o.limit_price_cents FROM orders o
           WHERE o.ticker = s.ticker AND o.side = 'SELL' AND o.status IN ('OPEN', 'PARTIALLY_FILLED')
           ORDER BY o.limit_price_cents ASC LIMIT 1) AS best_ask,
         (SELECT COALESCE(SUM(t.quantity), 0)::bigint FROM trades t
           WHERE t.ticker = s.ticker AND t.executed_at > now() - interval '24 hours') AS volume_24h
    FROM securities s`;

export async function isMarketHalted(q: Queryable): Promise<{ reason: string; startedAt: Date } | null> {
  const r = await q.query<{ reason: string; started_at: Date }>(
    `SELECT reason, started_at FROM trading_halts WHERE scope = 'MARKET' AND ended_at IS NULL`,
  );
  return r.rows[0] ? { reason: r.rows[0].reason, startedAt: r.rows[0].started_at } : null;
}

function toView(r: SecurityRow, marketHalted: boolean): SecurityView {
  const refKind = r.reference_price_source === null ? null : r.reference_price_source === 'ADMIN_SIMULATION' ? 'SIMULATED' : 'VERIFIED';
  const display = r.last_price_cents ?? r.reference_price_cents;
  const displayKind =
    r.last_price_cents !== null
      ? 'LAST_TRADE'
      : r.reference_price_cents !== null
        ? refKind === 'SIMULATED'
          ? 'REFERENCE_SIMULATED'
          : 'REFERENCE_VERIFIED'
        : null;
  const block = tradingBlockReason(r, r.symbol_halted, marketHalted);
  return {
    ticker: r.ticker,
    name: r.name,
    originalRank: r.original_rank,
    listingStatus: r.status,
    tradable: block === null,
    tradingBlockReason: block,
    symbolHalted: r.symbol_halted,
    referencePriceCents: num(r.reference_price_cents),
    referencePriceKind: refKind,
    lastPriceCents: num(r.last_price_cents),
    lastTradeAt: iso(r.last_trade_at),
    displayPriceCents: num(display),
    displayPriceKind: displayKind,
    changeFromReferenceBps:
      r.last_price_cents !== null && r.reference_price_cents !== null
        ? num(((r.last_price_cents - r.reference_price_cents) * 10000n) / r.reference_price_cents)
        : null,
    bestBidCents: num(r.best_bid),
    bestAskCents: num(r.best_ask),
    volume24h: num(r.volume_24h),
    description: r.description,
    imageUrl: r.image_url,
  };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function listSecurities(q: Queryable, search?: string): Promise<SecurityView[]> {
  const term = search?.trim() ? escapeLike(search.trim().slice(0, 64)) : null;
  const [rows, halt] = await Promise.all([
    q.query<SecurityRow>(
      `${SECURITY_SELECT}
       WHERE ($1::text IS NULL OR s.ticker ILIKE $1 || '%' OR s.name ILIKE '%' || $1 || '%')
       ORDER BY s.original_rank`,
      [term],
    ),
    isMarketHalted(q),
  ]);
  return rows.rows.map((r) => toView(r, halt !== null));
}

export async function getSecurity(q: Queryable, ticker: string): Promise<SecurityDetailView> {
  const [rows, halt, notes] = await Promise.all([
    q.query<SecurityRow>(`${SECURITY_SELECT} WHERE s.ticker = $1`, [ticker]),
    isMarketHalted(q),
    q.query<{ change_bps: number | null; note: string | null; kind: string }>(
      `SELECT change_bps, note, kind FROM security_history_notes WHERE ticker = $1 ORDER BY ordinal`,
      [ticker],
    ),
  ]);
  const r = rows.rows[0];
  if (!r) throw notFound('Security');
  return {
    ...toView(r, halt !== null),
    news: r.news,
    background: r.background,
    tradingRestriction: r.trading_restriction,
    bookVersion: num(r.book_version),
    historicalNotes: notes.rows.map((n) => ({ changeBps: n.change_bps, note: n.note, kind: n.kind })),
  };
}

export async function recentTrades(q: Queryable, ticker: string, limit: number, beforeId?: number): Promise<TradeView[]> {
  const r = await q.query<TradeRow>(
    `SELECT id, ticker, price_cents, quantity, aggressor_side, executed_at FROM trades
      WHERE ticker = $1 AND ($3::bigint IS NULL OR id < $3)
      ORDER BY id DESC LIMIT $2`,
    [ticker, limit, beforeId ?? null],
  );
  return r.rows.map(tradeView);
}

const BUCKETS: Record<string, string> = { '1m': '1 minute', '5m': '5 minutes', '15m': '15 minutes', '1h': '1 hour', '1d': '1 day' };

export type HistoryPoint =
  | { kind: 'trade'; tradeId: number; at: string; priceCents: number; quantity: number }
  | { kind: 'bar'; at: string; openCents: number; highCents: number; lowCents: number; closeCents: number; volume: number; trades: number };

/** Real executions only. No synthesized/random points. */
export async function priceHistory(
  q: Queryable,
  ticker: string,
  opts: { interval: string; from?: string; to?: string; limit: number },
): Promise<{ ticker: string; interval: string; referencePriceCents: number | null; referencePriceKind: string | null; points: HistoryPoint[] }> {
  const sec = await q.query<{ reference_price_cents: bigint | null; reference_price_source: string | null }>(
    `SELECT reference_price_cents, reference_price_source FROM securities WHERE ticker = $1`,
    [ticker],
  );
  if (!sec.rows[0]) throw notFound('Security');
  const from = opts.from ?? null;
  const to = opts.to ?? null;
  let points: HistoryPoint[];
  if (opts.interval === 'trade') {
    const r = await q.query<{ trade_id: bigint; recorded_at: Date; price_cents: bigint; quantity: bigint }>(
      `SELECT * FROM (
         SELECT trade_id, recorded_at, price_cents, quantity, id FROM price_history
          WHERE ticker = $1 AND ($2::timestamptz IS NULL OR recorded_at >= $2) AND ($3::timestamptz IS NULL OR recorded_at < $3)
          ORDER BY id DESC LIMIT $4) x ORDER BY id ASC`,
      [ticker, from, to, opts.limit],
    );
    points = r.rows.map((p) => ({
      kind: 'trade' as const,
      tradeId: num(p.trade_id),
      at: iso(p.recorded_at)!,
      priceCents: num(p.price_cents),
      quantity: num(p.quantity),
    }));
  } else {
    const bucket = BUCKETS[opts.interval]!;
    const r = await q.query<{ bucket: Date; o: bigint; h: bigint; l: bigint; c: bigint; v: bigint; n: bigint }>(
      `SELECT * FROM (
         SELECT date_bin($2::interval, recorded_at, TIMESTAMPTZ '2000-01-01') AS bucket,
                (array_agg(price_cents ORDER BY id ASC))[1] AS o, MAX(price_cents) AS h, MIN(price_cents) AS l,
                (array_agg(price_cents ORDER BY id DESC))[1] AS c, SUM(quantity)::bigint AS v, COUNT(*)::bigint AS n
           FROM price_history
          WHERE ticker = $1 AND ($3::timestamptz IS NULL OR recorded_at >= $3) AND ($4::timestamptz IS NULL OR recorded_at < $4)
          GROUP BY 1 ORDER BY 1 DESC LIMIT $5) x ORDER BY bucket ASC`,
      [ticker, bucket, from, to, opts.limit],
    );
    points = r.rows.map((b) => ({
      kind: 'bar' as const,
      at: iso(b.bucket)!,
      openCents: num(b.o),
      highCents: num(b.h),
      lowCents: num(b.l),
      closeCents: num(b.c),
      volume: num(b.v),
      trades: num(b.n),
    }));
  }
  const s = sec.rows[0];
  return {
    ticker,
    interval: opts.interval,
    referencePriceCents: num(s.reference_price_cents),
    referencePriceKind: s.reference_price_source === null ? null : s.reference_price_source === 'ADMIN_SIMULATION' ? 'SIMULATED' : 'VERIFIED',
    points,
  };
}

export async function movers(q: Queryable, limit: number): Promise<{ gainers: SecurityView[]; losers: SecurityView[] }> {
  const all = (await listSecurities(q)).filter((s) => s.changeFromReferenceBps !== null);
  const sorted = [...all].sort((a, b) => b.changeFromReferenceBps! - a.changeFromReferenceBps! || a.originalRank - b.originalRank);
  return {
    gainers: sorted.filter((s) => s.changeFromReferenceBps! > 0).slice(0, limit),
    losers: sorted
      .filter((s) => s.changeFromReferenceBps! < 0)
      .reverse()
      .slice(0, limit),
  };
}

export async function marketStatus(q: Queryable): Promise<MarketStatusView> {
  const [halt, ms] = await Promise.all([
    isMarketHalted(q),
    q.query<{ current_epoch: number }>(`SELECT current_epoch FROM market_state WHERE id = 1`),
  ]);
  return {
    open: halt === null,
    marketHalt: halt ? { reason: halt.reason, startedAt: iso(halt.startedAt)! } : null,
    epoch: ms.rows[0]!.current_epoch,
    serverTime: new Date().toISOString(),
  };
}
