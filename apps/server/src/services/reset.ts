import type { Pool } from '../db/pool.js';
import { withTx } from '../db/tx.js';
import { audit } from '../lib/audit.js';
import { conflict, unauthorized } from '../lib/errors.js';
import { enqueueOutbox, rooms } from '../lib/outbox.js';
import { verifyPassword } from './passwords.js';

export interface ResetInput {
  adminId: string;
  adminPassword: string;
  reason: string;
  ip?: string | null;
  startingCashCents: bigint;
  marketMakerCashCents: bigint;
}

/**
 * Strongly protected simulation reset. Preconditions (all enforced here, not just in the route):
 *   - caller is an ADMIN who re-enters their password,
 *   - the exact confirmation phrase was supplied (validated by the route schema),
 *   - the market is currently HALTED market-wide.
 * Effects (one transaction): wipes orders/trades/ledgers/holdings, regrants
 * starting cash, starts a new epoch. The immutable issuance ledger is kept;
 * old-epoch issuance simply no longer counts toward supply.
 */
export async function resetSimulation(pool: Pool, input: ResetInput) {
  const admin = await pool.query<{ password_hash: string | null; role: string; status: string }>(
    `SELECT password_hash, role, status FROM users WHERE id = $1`,
    [input.adminId],
  );
  const a = admin.rows[0];
  if (!a || a.role !== 'ADMIN' || a.status !== 'ACTIVE' || !a.password_hash || !(await verifyPassword(a.password_hash, input.adminPassword))) {
    throw unauthorized('Re-authentication failed');
  }
  return withTx(pool, async (c) => {
    const ms = await c.query<{ current_epoch: number }>(`SELECT current_epoch FROM market_state WHERE id = 1 FOR UPDATE`);
    const prevEpoch = ms.rows[0]!.current_epoch;
    const halted = await c.query(`SELECT 1 FROM trading_halts WHERE scope = 'MARKET' AND ended_at IS NULL`);
    if (halted.rowCount === 0) throw conflict('MARKET_NOT_HALTED', 'Halt the market before resetting the simulation');

    const counts = (
      await c.query<Record<string, bigint>>(`
        SELECT (SELECT COUNT(*) FROM trades) AS trades, (SELECT COUNT(*) FROM orders) AS orders,
               (SELECT COUNT(*) FROM users WHERE account_type = 'HUMAN') AS users,
               (SELECT COALESCE(SUM(cash_cents), 0)::bigint FROM cash_accounts) AS total_cash_before`)
    ).rows[0]!;

    await c.query(`SET LOCAL aez.allow_reset = 'on'`);
    for (const t of ['outbox_events', 'price_history', 'position_ledger', 'cash_ledger', 'trades', 'idempotency_keys', 'orders', 'holdings']) {
      await c.query(`DELETE FROM ${t}`);
    }
    const newEpoch = prevEpoch + 1;
    await c.query(`UPDATE market_state SET current_epoch = $1, updated_at = now() WHERE id = 1`, [newEpoch]);
    await c.query(
      `UPDATE cash_accounts c SET reserved_cents = 0, updated_at = now(),
              cash_cents = CASE WHEN u.account_type = 'MARKET_MAKER' THEN $1::bigint ELSE $2::bigint END
         FROM users u WHERE u.id = c.user_id`,
      [input.marketMakerCashCents, input.startingCashCents],
    );
    await c.query(
      `INSERT INTO cash_ledger (user_id, amount_cents, balance_after_cents, reason, epoch)
       SELECT c.user_id, c.cash_cents, c.cash_cents,
              CASE WHEN u.account_type = 'MARKET_MAKER' THEN 'MARKET_MAKER_FUNDING'::cash_ledger_reason ELSE 'INITIAL_GRANT'::cash_ledger_reason END, $1
         FROM cash_accounts c JOIN users u ON u.id = c.user_id
        WHERE c.cash_cents > 0
        ORDER BY c.user_id`,
      [newEpoch],
    );
    await c.query(`UPDATE securities SET last_price_cents = NULL, last_trade_at = NULL, book_version = book_version + 1, updated_at = now()`);
    await c.query(`UPDATE market_maker_configs SET opened_epoch = NULL, opened_at = NULL, updated_at = now()`);
    const summary = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.toString()]));
    await c.query(
      `INSERT INTO simulation_resets (previous_epoch, new_epoch, performed_by, reason, summary) VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [prevEpoch, newEpoch, input.adminId, input.reason, JSON.stringify(summary)],
    );
    await audit(c, {
      actorUserId: input.adminId,
      action: 'SIMULATION_RESET',
      targetType: 'market',
      details: { previousEpoch: prevEpoch, newEpoch, reason: input.reason, summary },
      ip: input.ip,
    });
    await enqueueOutbox(c, [{ event: 'market.reset', room: rooms.market, payload: { epoch: newEpoch } }]);
    return { previousEpoch: prevEpoch, newEpoch, summary };
  });
}
