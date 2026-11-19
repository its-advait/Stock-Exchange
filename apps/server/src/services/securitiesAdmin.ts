import { HISTORICAL_NOTES, STOCK_UNIVERSE } from '@aez/shared';
import type { Pool, Queryable } from '../db/pool.js';
import { withTx } from '../db/tx.js';
import { audit } from '../lib/audit.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { enqueueOutbox, rooms } from '../lib/outbox.js';

interface Actor {
  adminId: string;
  ip?: string | null;
}

/**
 * Idempotently seed the 45 canonical securities (status + reference price
 * left NULL = unverified) and the historical annotations. Refuses to continue
 * if an existing row disagrees with the canonical ticker/name/rank.
 */
export async function seedUniverse(c: Queryable): Promise<{ inserted: number }> {
  let inserted = 0;
  for (const s of STOCK_UNIVERSE) {
    const r = await c.query(
      `INSERT INTO securities (ticker, name, original_rank, description) VALUES ($1, $2, $3, $4)
       ON CONFLICT (ticker) DO NOTHING`,
      [s.ticker, s.name, s.rank, `${s.name} (${s.ticker}), a fictional AEZ brotherhood security.`],
    );
    inserted += r.rowCount ?? 0;
  }
  const existing = await c.query<{ ticker: string; name: string; original_rank: number }>(
    `SELECT ticker, name, original_rank FROM securities`,
  );
  const canon = new Map(STOCK_UNIVERSE.map((s) => [s.ticker, s]));
  for (const row of existing.rows) {
    const s = canon.get(row.ticker);
    if (!s) throw new Error(`Non-canonical security in database: ${row.ticker}`);
    if (s.name !== row.name || s.rank !== row.original_rank)
      throw new Error(`Security ${row.ticker} disagrees with canonical universe (name/rank)`);
  }
  if (existing.rows.length !== STOCK_UNIVERSE.length) throw new Error('Security universe incomplete');

  const perTicker = new Map<string, number>();
  for (const n of HISTORICAL_NOTES) {
    const ordinal = (perTicker.get(n.ticker) ?? 0) + 1;
    perTicker.set(n.ticker, ordinal);
    await c.query(
      `INSERT INTO security_history_notes (ticker, ordinal, change_bps, note) VALUES ($1, $2, $3, $4)
       ON CONFLICT (ticker, ordinal) DO NOTHING`,
      [n.ticker, ordinal, n.changeBps, n.note],
    );
  }
  return { inserted };
}

/**
 * Documented, authorized administrative change of a listing status (e.g. lifting
 * an original SUSPENDED restriction). Requires a reason AND a reference to the
 * authorization; fully audited with the previous value.
 */
export async function setListingStatus(
  pool: Pool,
  actor: Actor,
  ticker: string,
  input: { status: 'ACTIVE' | 'HALTED' | 'SUSPENDED' | 'UNLISTED'; reason: string; authorizationReference: string },
): Promise<void> {
  await withTx(pool, async (c) => {
    await c.query(`SELECT 1 FROM market_state WHERE id = 1 FOR SHARE`);
    const prev = await c.query<{ status: string | null; status_source: string | null }>(
      `SELECT status, status_source FROM securities WHERE ticker = $1 FOR UPDATE`,
      [ticker],
    );
    if (!prev.rows[0]) throw notFound('Security');
    await c.query(
      `UPDATE securities SET status = $2, status_source = 'ADMIN_AUTHORIZED', status_updated_at = now(), updated_at = now()
        WHERE ticker = $1`,
      [ticker, input.status],
    );
    await audit(c, {
      actorUserId: actor.adminId,
      action: 'LISTING_STATUS_CHANGE',
      targetType: 'security',
      targetId: ticker,
      details: { previous: prev.rows[0], next: input.status, reason: input.reason, authorizationReference: input.authorizationReference },
      ip: actor.ip,
    });
    await enqueueOutbox(c, [
      { event: 'security.status', room: rooms.ticker(ticker), payload: { ticker } },
      { event: 'security.status', room: rooms.market, payload: { ticker } },
    ]);
  });
}

/**
 * Clearly-labeled, administrator-approved SIMULATION reference price, for use
 * before the verified original dataset is available. Never overwrites a
 * verified price and never overrides a verified/authorized listing status.
 */
export async function setSimulatedReference(
  pool: Pool,
  actor: Actor,
  ticker: string,
  input: { referencePriceCents: bigint; activate: boolean; note: string },
): Promise<void> {
  await withTx(pool, async (c) => {
    await c.query(`SELECT 1 FROM market_state WHERE id = 1 FOR SHARE`);
    const r = await c.query<{ reference_price_source: string | null; status: string | null; status_source: string | null }>(
      `SELECT reference_price_source, status, status_source FROM securities WHERE ticker = $1 FOR UPDATE`,
      [ticker],
    );
    const s = r.rows[0];
    if (!s) throw notFound('Security');
    if (s.reference_price_source === 'VERIFIED_IMPORT')
      throw conflict('VERIFIED_PRICE_EXISTS', 'A verified reference price exists; simulation cannot override it');
    if (input.activate && s.status !== null && s.status_source !== 'ADMIN_SIMULATION')
      throw conflict('STATUS_VERIFIED', `Listing status ${s.status} is verified/authorized; simulation cannot override it`);
    await c.query(
      `UPDATE securities SET reference_price_cents = $2, reference_price_source = 'ADMIN_SIMULATION', reference_verified_at = now(),
              reference_verified_by = $3, verification_source_ref = $4,
              status = CASE WHEN $5::boolean THEN 'ACTIVE'::security_status ELSE status END,
              status_source = CASE WHEN $5::boolean THEN 'ADMIN_SIMULATION'::security_data_source ELSE status_source END,
              status_updated_at = CASE WHEN $5::boolean THEN now() ELSE status_updated_at END,
              updated_at = now()
        WHERE ticker = $1`,
      [ticker, input.referencePriceCents, `admin:${actor.adminId}`, `SIMULATION: ${input.note}`, input.activate],
    );
    await audit(c, {
      actorUserId: actor.adminId,
      action: 'SIMULATED_REFERENCE_SET',
      targetType: 'security',
      targetId: ticker,
      details: { referencePriceCents: input.referencePriceCents, activate: input.activate, note: input.note },
      ip: actor.ip,
    });
    await enqueueOutbox(c, [{ event: 'security.status', room: rooms.market, payload: { ticker } }]);
  });
}

export function assertTicker(ticker: string): void {
  if (!STOCK_UNIVERSE.some((s) => s.ticker === ticker)) throw new AppError(404, 'NOT_FOUND', 'Security not found');
}
