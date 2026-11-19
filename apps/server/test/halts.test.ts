import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cancelOrder } from '../src/engine/matching.js';
import { haltMarket, haltSymbol, resumeMarket, resumeSymbol } from '../src/services/halts.js';
import { getSecurity, listSecurities } from '../src/services/market.js';
import { setListingStatus, setSimulatedReference } from '../src/services/securitiesAdmin.js';
import { activate, cashOf, grantShares, limit, makeUser, newPool, place, resetDatabase, STARTING_CASH } from './helpers.js';

const pool = newPool();
const T = 'MUNCH';
let admin: string;

beforeEach(async () => {
  await resetDatabase(pool);
  await activate(pool, T, 1000n);
  admin = await makeUser(pool, 'admin_user', 'ADMIN');
});
afterAll(() => pool.end());

describe('trading eligibility', () => {
  it('freshly seeded securities are non-tradable until verified', async () => {
    const all = await listSecurities(pool);
    expect(all).toHaveLength(45);
    const unverified = all.filter((s) => s.ticker !== T);
    expect(unverified.every((s) => !s.tradable && s.tradingBlockReason === 'STATUS_UNVERIFIED')).toBe(true);
    expect(unverified.every((s) => s.displayPriceCents === null)).toBe(true);
    const u = await makeUser(pool);
    const r = await place(pool, limit(u, 'JINK', 'BUY', 1n, 100n));
    expect(r.order.rejectReason).toBe('STATUS_UNVERIFIED');
  });

  it('original SUSPENDED/UNLISTED status blocks trading; resuming a symbol halt does not bypass it', async () => {
    await pool.query(`UPDATE securities SET status = 'SUSPENDED', status_source = 'VERIFIED_IMPORT' WHERE ticker = $1`, [T]);
    const u = await makeUser(pool);
    expect((await place(pool, limit(u, T, 'BUY', 1n, 100n))).order.rejectReason).toBe('SECURITY_SUSPENDED');
    await haltSymbol(pool, { adminId: admin }, T, 'test halt');
    await resumeSymbol(pool, { adminId: admin }, T, 'test resume');
    expect((await place(pool, limit(u, T, 'BUY', 1n, 100n))).order.rejectReason).toBe('SECURITY_SUSPENDED');
    // Simulation cannot override a verified status.
    await expect(
      setSimulatedReference(pool, { adminId: admin }, T, { referencePriceCents: 500n, activate: true, note: 'nope' }),
    ).rejects.toMatchObject({ code: 'VERIFIED_PRICE_EXISTS' });
    // Only the documented, authorized admin action changes it (and it is audited).
    await setListingStatus(pool, { adminId: admin }, T, {
      status: 'ACTIVE',
      reason: 'Suspension lifted',
      authorizationReference: 'Exec board vote, minutes item 4',
    });
    expect((await place(pool, limit(u, T, 'BUY', 1n, 100n))).order.status).toBe('OPEN');
    const log = await pool.query(`SELECT details FROM audit_logs WHERE action = 'LISTING_STATUS_CHANGE'`);
    expect(log.rows[0].details).toMatchObject({ authorizationReference: 'Exec board vote, minutes item 4', previous: { status: 'SUSPENDED' } });
  });

  it('simulated reference prices are labeled SIMULATED', async () => {
    await setSimulatedReference(pool, { adminId: admin }, 'ALI', { referencePriceCents: 777n, activate: true, note: 'dev' });
    const s = await getSecurity(pool, 'ALI');
    expect(s.tradable).toBe(true);
    expect(s.referencePriceKind).toBe('SIMULATED');
    expect(s.displayPriceKind).toBe('REFERENCE_SIMULATED');
    expect(s.displayPriceCents).toBe(777);
  });
});

describe('market halts', () => {
  it('market-wide halt rejects new orders, allows cancels, and resume reopens', async () => {
    const [b, s] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 10n);
    const bid = await place(pool, limit(b, T, 'BUY', 5n, 1000n));
    await haltMarket(pool, { adminId: admin }, 'Scheduled maintenance');
    await expect(haltMarket(pool, { adminId: admin }, 'again')).rejects.toMatchObject({ code: 'ALREADY_HALTED' });
    const r = await place(pool, limit(s, T, 'SELL', 5n, 1000n));
    expect(r.order.status).toBe('REJECTED');
    expect(r.order.rejectReason).toBe('MARKET_HALTED');
    expect((await getSecurity(pool, T)).tradingBlockReason).toBe('MARKET_HALTED');
    await cancelOrder(pool, { orderId: bid.order.id, actorUserId: b });
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH, reserved: 0n });
    await resumeMarket(pool, { adminId: admin }, 'Done');
    await expect(resumeMarket(pool, { adminId: admin }, 'Done')).rejects.toMatchObject({ code: 'NOT_HALTED' });
    expect((await place(pool, limit(s, T, 'SELL', 5n, 1000n))).order.status).toBe('OPEN');
  });

  it('symbol halt only affects that symbol', async () => {
    await activate(pool, 'LAU', 500n);
    const u = await makeUser(pool);
    await haltSymbol(pool, { adminId: admin }, T, 'news pending');
    expect((await place(pool, limit(u, T, 'BUY', 1n, 100n))).order.rejectReason).toBe('SYMBOL_HALTED');
    expect((await place(pool, limit(u, 'LAU', 'BUY', 1n, 100n))).order.status).toBe('OPEN');
    await resumeSymbol(pool, { adminId: admin }, T, 'news out');
    expect((await place(pool, limit(u, T, 'BUY', 1n, 100n))).order.status).toBe('OPEN');
  });

  it('a halt issued while orders are in flight serializes cleanly (no order slips through after commit)', async () => {
    const u = await makeUser(pool);
    const orders = Array.from({ length: 30 }, () => place(pool, limit(u, T, 'BUY', 1n, 10n)));
    const halt = haltMarket(pool, { adminId: admin }, 'race');
    const results = await Promise.all(orders);
    await halt;
    // Every racing order was either accepted before the halt took effect or rejected by it.
    expect(results.every((r) => r.order.status === 'OPEN' || r.order.rejectReason === 'MARKET_HALTED')).toBe(true);
    expect((await place(pool, limit(u, T, 'BUY', 1n, 10n))).order.rejectReason).toBe('MARKET_HALTED');
  });
});
