import type { BookLevel, OrderBookView } from '@aez/shared';
import type { Queryable } from '../db/pool.js';
import { num } from '../lib/json.js';

/**
 * Aggregated order book depth. Uses the partial price-time indexes
 * (orders_book_bids_idx / orders_book_asks_idx). When called inside a matching
 * transaction (holding the symbol lock) the snapshot is exactly the
 * post-commit book.
 */
export async function getOrderBook(q: Queryable, ticker: string, depth = 10): Promise<OrderBookView> {
  // Sequential on purpose: `q` may be a single transaction client.
  const bids = await q.query<{ price: bigint; qty: bigint; n: bigint }>(
      `SELECT limit_price_cents AS price, SUM(quantity - filled_quantity)::bigint AS qty, COUNT(*)::bigint AS n
         FROM orders
        WHERE ticker = $1 AND side = 'BUY' AND status IN ('OPEN', 'PARTIALLY_FILLED')
        GROUP BY limit_price_cents
        ORDER BY limit_price_cents DESC NULLS LAST
        LIMIT $2`,
      [ticker, depth],
  );
  const asks = await q.query<{ price: bigint; qty: bigint; n: bigint }>(
      `SELECT limit_price_cents AS price, SUM(quantity - filled_quantity)::bigint AS qty, COUNT(*)::bigint AS n
         FROM orders
        WHERE ticker = $1 AND side = 'SELL' AND status IN ('OPEN', 'PARTIALLY_FILLED')
        GROUP BY limit_price_cents
        ORDER BY limit_price_cents ASC
        LIMIT $2`,
      [ticker, depth],
  );
  const ver = await q.query<{ book_version: bigint }>(`SELECT book_version FROM securities WHERE ticker = $1`, [ticker]);
  const lvl = (r: { price: bigint; qty: bigint; n: bigint }): BookLevel => ({
    priceCents: num(r.price),
    quantity: num(r.qty),
    orders: num(r.n),
  });
  const b = bids.rows.map(lvl);
  const a = asks.rows.map(lvl);
  const bestBid = b[0]?.priceCents ?? null;
  const bestAsk = a[0]?.priceCents ?? null;
  return {
    ticker,
    bookVersion: num(ver.rows[0]?.book_version ?? 0n),
    bestBidCents: bestBid,
    bestAskCents: bestAsk,
    spreadCents: bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null,
    bids: b,
    asks: a,
  };
}
