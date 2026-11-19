/**
 * System market maker + share issuance.
 *
 * Shares come into existence ONLY through `issueShares`, which writes an
 * immutable security_issuance row and a matching position_ledger row in the
 * same transaction as the holdings increase. Trades only move shares between
 * accounts, so for every ticker:
 *     SUM(holdings.quantity) == SUM(security_issuance.quantity in current epoch)
 *
 * The market maker is an ordinary account with finite cash and inventory. Its
 * quotes go through the normal matching engine with normal reservations.
 */
import type { MarketMakerConfigRequest, OrderView } from '@aez/shared';
import type { Client, Pool } from '../db/pool.js';
import { withTx } from '../db/tx.js';
import { placeOrderInTx } from '../engine/matching.js';
import { tradingBlockReason } from '../engine/tradability.js';
import { audit } from '../lib/audit.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { getMarketMakerId } from './accounts.js';

interface Actor {
  adminId: string;
  ip?: string | null;
}

/** Caller MUST hold the securities row lock (FOR UPDATE) for `ticker`. */
export async function issueShares(
  c: Client,
  input: { ticker: string; recipientUserId: string; quantity: bigint; reason: string; approvedBy: string | null; epoch: number },
): Promise<bigint> {
  if (input.quantity <= 0n) throw new AppError(400, 'INVALID_QUANTITY', 'Issuance quantity must be positive');
  const iss = await c.query<{ id: bigint }>(
    `INSERT INTO security_issuance (epoch, ticker, recipient_user_id, quantity, reason, approved_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.epoch, input.ticker, input.recipientUserId, input.quantity, input.reason, input.approvedBy],
  );
  const h = await c.query<{ quantity: bigint }>(
    `INSERT INTO holdings (user_id, ticker, quantity) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, ticker) DO UPDATE SET quantity = holdings.quantity + EXCLUDED.quantity, updated_at = now()
     RETURNING quantity`,
    [input.recipientUserId, input.ticker, input.quantity],
  );
  await c.query(
    `INSERT INTO position_ledger (user_id, ticker, quantity_delta, quantity_after, reason, issuance_id, epoch)
     VALUES ($1, $2, $3, $4, 'ISSUANCE', $5, $6)`,
    [input.recipientUserId, input.ticker, input.quantity, h.rows[0]!.quantity, iss.rows[0]!.id, input.epoch],
  );
  return iss.rows[0]!.id;
}

export async function upsertMarketMakerConfig(pool: Pool, actor: Actor, ticker: string, cfg: MarketMakerConfigRequest): Promise<void> {
  await withTx(pool, async (c) => {
    const s = await c.query(`SELECT 1 FROM securities WHERE ticker = $1`, [ticker]);
    if (s.rowCount === 0) throw notFound('Security');
    await c.query(
      `INSERT INTO market_maker_configs (ticker, inventory_shares, ask_levels, bid_levels, enabled, note, approved_by, approved_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, now())
       ON CONFLICT (ticker) DO UPDATE SET inventory_shares = EXCLUDED.inventory_shares, ask_levels = EXCLUDED.ask_levels,
         bid_levels = EXCLUDED.bid_levels, enabled = EXCLUDED.enabled, note = EXCLUDED.note,
         approved_by = EXCLUDED.approved_by, approved_at = now(), updated_at = now()`,
      [ticker, cfg.inventoryShares, JSON.stringify(cfg.askLevels), JSON.stringify(cfg.bidLevels), cfg.enabled, cfg.note, actor.adminId],
    );
    await audit(c, { actorUserId: actor.adminId, action: 'MARKET_MAKER_CONFIG', targetType: 'security', targetId: ticker, details: cfg, ip: actor.ip });
  });
}

/** price = round_half_up(reference * (10000 + offsetBps) / 10000), integer cents. */
export function levelPrice(referenceCents: bigint, offsetBps: number): bigint {
  const p = (referenceCents * BigInt(10000 + offsetBps) + 5000n) / 10000n;
  return p < 1n ? 1n : p;
}

/**
 * Open liquidity for one security (once per simulation epoch): issue the
 * configured inventory to the market maker, then place its quotes through the
 * normal engine. All-or-nothing.
 */
export async function openLiquidity(pool: Pool, actor: Actor, ticker: string): Promise<{ orders: OrderView[]; issuedShares: number }> {
  return withTx(pool, async (c) => {
    const ms = await c.query<{ current_epoch: number }>(`SELECT current_epoch FROM market_state WHERE id = 1 FOR SHARE`);
    const epoch = ms.rows[0]!.current_epoch;
    const marketHalted = (await c.query(`SELECT 1 FROM trading_halts WHERE scope = 'MARKET' AND ended_at IS NULL`)).rowCount! > 0;
    const sec = (
      await c.query<{ status: 'ACTIVE' | 'HALTED' | 'SUSPENDED' | 'UNLISTED' | null; reference_price_cents: bigint | null }>(
        `SELECT status, reference_price_cents FROM securities WHERE ticker = $1 FOR UPDATE`,
        [ticker],
      )
    ).rows[0];
    if (!sec) throw notFound('Security');
    const symbolHalted =
      (await c.query(`SELECT 1 FROM trading_halts WHERE scope = 'SYMBOL' AND ticker = $1 AND ended_at IS NULL`, [ticker])).rowCount! > 0;
    const block = tradingBlockReason(sec, symbolHalted, marketHalted);
    if (block) throw conflict('NOT_TRADABLE', `Cannot open liquidity: ${block}`);

    const cfg = (
      await c.query<{
        inventory_shares: bigint;
        ask_levels: { offsetBps: number; quantity: number }[];
        bid_levels: { offsetBps: number; quantity: number }[];
        enabled: boolean;
        opened_epoch: number | null;
      }>(`SELECT inventory_shares, ask_levels, bid_levels, enabled, opened_epoch FROM market_maker_configs WHERE ticker = $1 FOR UPDATE`, [
        ticker,
      ])
    ).rows[0];
    if (!cfg) throw conflict('NO_CONFIG', 'No market-maker configuration for this security');
    if (!cfg.enabled) throw conflict('MM_DISABLED', 'Market-maker configuration is disabled');
    if (cfg.opened_epoch === epoch) throw conflict('ALREADY_OPENED', 'Liquidity was already opened for this security in this epoch');

    const mm = await getMarketMakerId(c);
    if (!mm) throw new AppError(500, 'NO_MARKET_MAKER', 'Market-maker account missing (run db:seed)');

    if (cfg.inventory_shares > 0n) {
      await issueShares(c, {
        ticker,
        recipientUserId: mm,
        quantity: cfg.inventory_shares,
        reason: `Opening market-maker inventory (epoch ${epoch})`,
        approvedBy: actor.adminId,
        epoch,
      });
    }
    const ref = sec.reference_price_cents!;
    const orders: OrderView[] = [];
    const place = async (side: 'BUY' | 'SELL', levels: { offsetBps: number; quantity: number }[]) => {
      for (const [i, l] of levels.entries()) {
        const out = await placeOrderInTx(c, {
          userId: mm,
          ticker,
          side,
          type: 'LIMIT',
          quantity: BigInt(l.quantity),
          limitPriceCents: levelPrice(ref, l.offsetBps),
          idempotencyKey: `mm-open:${epoch}:${ticker}:${side}:${i}`,
        });
        if (out.body.order.status === 'REJECTED')
          throw conflict('MM_ORDER_REJECTED', `Market-maker ${side} level ${i} rejected: ${out.body.order.rejectReason}`);
        orders.push(out.body.order);
      }
    };
    await place('SELL', cfg.ask_levels);
    await place('BUY', cfg.bid_levels);
    await c.query(`UPDATE market_maker_configs SET opened_epoch = $2, opened_at = now(), updated_at = now() WHERE ticker = $1`, [
      ticker,
      epoch,
    ]);
    await audit(c, {
      actorUserId: actor.adminId,
      action: 'MARKET_MAKER_OPEN',
      targetType: 'security',
      targetId: ticker,
      details: { epoch, issuedShares: cfg.inventory_shares, orders: orders.map((o) => o.id) },
      ip: actor.ip,
    });
    return { orders, issuedShares: Number(cfg.inventory_shares) };
  });
}
