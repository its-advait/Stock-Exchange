/**
 * Global accounting invariants. Used by tests after every scenario, exposed to
 * admins at GET /api/admin/integrity, and runnable via `npm run db:integrity`.
 */
import type { Queryable } from '../db/pool.js';

export interface IntegrityReport {
  ok: boolean;
  violations: string[];
  stats: { totalCashCents: string; grantedCashCents: string; trades: number; openOrders: number };
}

export async function checkIntegrity(q: Queryable): Promise<IntegrityReport> {
  const violations: string[] = [];
  const add = (label: string, rows: unknown[]) => {
    for (const r of rows) violations.push(`${label}: ${JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
  };

  // 1. Share supply conservation per ticker (current epoch issuance == holdings).
  add(
    'SHARE_SUPPLY_MISMATCH',
    (
      await q.query(`
        WITH iss AS (
          SELECT ticker, SUM(quantity)::bigint AS issued FROM security_issuance
           WHERE epoch = (SELECT current_epoch FROM market_state WHERE id = 1) GROUP BY ticker),
        held AS (SELECT ticker, SUM(quantity)::bigint AS held FROM holdings GROUP BY ticker)
        SELECT COALESCE(iss.ticker, held.ticker) AS ticker, COALESCE(issued, 0) AS issued, COALESCE(held, 0) AS held
          FROM iss FULL OUTER JOIN held ON held.ticker = iss.ticker
         WHERE COALESCE(issued, 0) <> COALESCE(held, 0)`)
    ).rows,
  );

  // 2. Each account's cash equals the sum of its cash ledger entries.
  add(
    'CASH_LEDGER_MISMATCH',
    (
      await q.query(`
        SELECT c.user_id, c.cash_cents, COALESCE(SUM(l.amount_cents), 0)::bigint AS ledger
          FROM cash_accounts c LEFT JOIN cash_ledger l ON l.user_id = c.user_id
         GROUP BY c.user_id, c.cash_cents HAVING c.cash_cents <> COALESCE(SUM(l.amount_cents), 0)`)
    ).rows,
  );

  // 3. Each holding equals the sum of its position ledger entries.
  add(
    'POSITION_LEDGER_MISMATCH',
    (
      await q.query(`
        SELECT h.user_id, h.ticker, h.quantity, COALESCE(SUM(l.quantity_delta), 0)::bigint AS ledger
          FROM holdings h LEFT JOIN position_ledger l ON l.user_id = h.user_id AND l.ticker = h.ticker
         GROUP BY h.user_id, h.ticker, h.quantity HAVING h.quantity <> COALESCE(SUM(l.quantity_delta), 0)`)
    ).rows,
  );

  // 4. Reserved cash == sum of reservations of the account's resting buy orders.
  add(
    'RESERVED_CASH_MISMATCH',
    (
      await q.query(`
        SELECT c.user_id, c.reserved_cents, COALESCE(SUM(o.reserved_cents), 0)::bigint AS orders_reserved
          FROM cash_accounts c
          LEFT JOIN orders o ON o.user_id = c.user_id AND o.side = 'BUY' AND o.status IN ('OPEN', 'PARTIALLY_FILLED')
         GROUP BY c.user_id, c.reserved_cents HAVING c.reserved_cents <> COALESCE(SUM(o.reserved_cents), 0)`)
    ).rows,
  );

  // 5. Reserved shares == sum of resting sell orders' reservations.
  add(
    'RESERVED_SHARES_MISMATCH',
    (
      await q.query(`
        SELECT h.user_id, h.ticker, h.reserved_quantity, COALESCE(SUM(o.reserved_quantity), 0)::bigint AS orders_reserved
          FROM holdings h
          LEFT JOIN orders o ON o.user_id = h.user_id AND o.ticker = h.ticker AND o.side = 'SELL'
                            AND o.status IN ('OPEN', 'PARTIALLY_FILLED')
         GROUP BY h.user_id, h.ticker, h.reserved_quantity HAVING h.reserved_quantity <> COALESCE(SUM(o.reserved_quantity), 0)`)
    ).rows,
  );

  // 6. Resting order reservation shape: buys reserve remaining*limit, sells reserve remaining.
  add(
    'ORDER_RESERVATION_SHAPE',
    (
      await q.query(`
        SELECT id, side, quantity, filled_quantity, limit_price_cents, reserved_cents, reserved_quantity FROM orders
         WHERE status IN ('OPEN', 'PARTIALLY_FILLED')
           AND NOT ((side = 'BUY' AND reserved_cents = (quantity - filled_quantity) * limit_price_cents)
                 OR (side = 'SELL' AND reserved_quantity = quantity - filled_quantity))`)
    ).rows,
  );

  // 7. Order fill totals agree with executions.
  add(
    'ORDER_FILL_MISMATCH',
    (
      await q.query(`
        SELECT o.id, o.filled_quantity, o.filled_notional_cents,
               COALESCE(SUM(t.quantity), 0)::bigint AS traded, COALESCE(SUM(t.quantity * t.price_cents), 0)::bigint AS traded_notional
          FROM orders o LEFT JOIN trades t ON (t.buy_order_id = o.id OR t.sell_order_id = o.id)
         GROUP BY o.id
        HAVING o.filled_quantity <> COALESCE(SUM(t.quantity), 0) OR o.filled_notional_cents <> COALESCE(SUM(t.quantity * t.price_cents), 0)`)
    ).rows,
  );

  // 8. No crossed book.
  add(
    'CROSSED_BOOK',
    (
      await q.query(`
        SELECT ticker, MAX(limit_price_cents) FILTER (WHERE side = 'BUY') AS best_bid,
                       MIN(limit_price_cents) FILTER (WHERE side = 'SELL') AS best_ask
          FROM orders WHERE status IN ('OPEN', 'PARTIALLY_FILLED') GROUP BY ticker
        HAVING MAX(limit_price_cents) FILTER (WHERE side = 'BUY') >= MIN(limit_price_cents) FILTER (WHERE side = 'SELL')`)
    ).rows,
  );

  // 9. Last price equals the most recent execution price.
  add(
    'LAST_PRICE_MISMATCH',
    (
      await q.query(`
        SELECT s.ticker, s.last_price_cents, t.price_cents
          FROM securities s
          LEFT JOIN LATERAL (SELECT price_cents FROM trades WHERE ticker = s.ticker ORDER BY id DESC LIMIT 1) t ON true
         WHERE s.last_price_cents IS DISTINCT FROM t.price_cents`)
    ).rows,
  );

  const stats = (
    await q.query<{ total: bigint; granted: bigint; trades: bigint; open_orders: bigint }>(`
      SELECT (SELECT COALESCE(SUM(cash_cents), 0)::bigint FROM cash_accounts) AS total,
             (SELECT COALESCE(SUM(amount_cents), 0)::bigint FROM cash_ledger WHERE reason IN ('INITIAL_GRANT', 'MARKET_MAKER_FUNDING')) AS granted,
             (SELECT COUNT(*) FROM trades) AS trades,
             (SELECT COUNT(*) FROM orders WHERE status IN ('OPEN', 'PARTIALLY_FILLED')) AS open_orders`)
  ).rows[0]!;
  // 10. Total cash is conserved: trades only transfer cash.
  if (stats.total !== stats.granted) violations.push(`TOTAL_CASH_NOT_CONSERVED: total=${stats.total} granted=${stats.granted}`);

  return {
    ok: violations.length === 0,
    violations,
    stats: { totalCashCents: stats.total.toString(), grantedCashCents: stats.granted.toString(), trades: Number(stats.trades), openOrders: Number(stats.open_orders) },
  };
}
