import type { Pool } from '../db/pool.js';
import { withTx } from '../db/tx.js';
import { audit } from '../lib/audit.js';
import { conflict, notFound, pgCode } from '../lib/errors.js';
import { enqueueOutbox, rooms } from '../lib/outbox.js';

interface Actor {
  adminId: string;
  ip?: string | null;
}

/** Market-wide halt. Takes market_state FOR UPDATE, so it waits for in-flight orders and blocks new ones until commit. */
export async function haltMarket(pool: Pool, actor: Actor, reason: string): Promise<void> {
  await withTx(pool, async (c) => {
    await c.query(`SELECT 1 FROM market_state WHERE id = 1 FOR UPDATE`);
    try {
      await c.query(`INSERT INTO trading_halts (scope, reason, started_by) VALUES ('MARKET', $1, $2)`, [reason, actor.adminId]);
    } catch (e) {
      if (pgCode(e) === '23505') throw conflict('ALREADY_HALTED', 'The market is already halted');
      throw e;
    }
    await audit(c, { actorUserId: actor.adminId, action: 'MARKET_HALT', targetType: 'market', details: { reason }, ip: actor.ip });
    await enqueueOutbox(c, [{ event: 'market.status', room: rooms.market, payload: { open: false, reason } }]);
  });
}

export async function resumeMarket(pool: Pool, actor: Actor, reason: string): Promise<void> {
  await withTx(pool, async (c) => {
    await c.query(`SELECT 1 FROM market_state WHERE id = 1 FOR UPDATE`);
    const r = await c.query(
      `UPDATE trading_halts SET ended_at = now(), ended_by = $1, end_reason = $2
        WHERE scope = 'MARKET' AND ended_at IS NULL RETURNING id`,
      [actor.adminId, reason],
    );
    if (r.rowCount === 0) throw conflict('NOT_HALTED', 'The market is not halted');
    await audit(c, { actorUserId: actor.adminId, action: 'MARKET_RESUME', targetType: 'market', details: { reason }, ip: actor.ip });
    await enqueueOutbox(c, [{ event: 'market.status', room: rooms.market, payload: { open: true, reason: null } }]);
  });
}

export async function haltSymbol(pool: Pool, actor: Actor, ticker: string, reason: string): Promise<void> {
  await withTx(pool, async (c) => {
    await c.query(`SELECT 1 FROM market_state WHERE id = 1 FOR SHARE`);
    const s = await c.query(`SELECT 1 FROM securities WHERE ticker = $1 FOR UPDATE`, [ticker]);
    if (s.rowCount === 0) throw notFound('Security');
    try {
      await c.query(`INSERT INTO trading_halts (scope, ticker, reason, started_by) VALUES ('SYMBOL', $1, $2, $3)`, [
        ticker,
        reason,
        actor.adminId,
      ]);
    } catch (e) {
      if (pgCode(e) === '23505') throw conflict('ALREADY_HALTED', `${ticker} is already halted`);
      throw e;
    }
    await audit(c, { actorUserId: actor.adminId, action: 'SYMBOL_HALT', targetType: 'security', targetId: ticker, details: { reason }, ip: actor.ip });
    await enqueueOutbox(c, [
      { event: 'security.status', room: rooms.ticker(ticker), payload: { ticker } },
      { event: 'security.status', room: rooms.market, payload: { ticker } },
    ]);
  });
}

/**
 * Ends an administrative symbol halt. This NEVER changes the original listing
 * status: a SUSPENDED/UNLISTED/unverified security stays non-tradable.
 */
export async function resumeSymbol(pool: Pool, actor: Actor, ticker: string, reason: string): Promise<void> {
  await withTx(pool, async (c) => {
    await c.query(`SELECT 1 FROM market_state WHERE id = 1 FOR SHARE`);
    const s = await c.query(`SELECT 1 FROM securities WHERE ticker = $1 FOR UPDATE`, [ticker]);
    if (s.rowCount === 0) throw notFound('Security');
    const r = await c.query(
      `UPDATE trading_halts SET ended_at = now(), ended_by = $2, end_reason = $3
        WHERE scope = 'SYMBOL' AND ticker = $1 AND ended_at IS NULL RETURNING id`,
      [ticker, actor.adminId, reason],
    );
    if (r.rowCount === 0) throw conflict('NOT_HALTED', `${ticker} is not halted`);
    await audit(c, { actorUserId: actor.adminId, action: 'SYMBOL_RESUME', targetType: 'security', targetId: ticker, details: { reason }, ip: actor.ip });
    await enqueueOutbox(c, [
      { event: 'security.status', room: rooms.ticker(ticker), payload: { ticker } },
      { event: 'security.status', room: rooms.market, payload: { ticker } },
    ]);
  });
}
