import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getOrderBook } from '../src/engine/book.js';
import { cancelOrder, placeOrder } from '../src/engine/matching.js';
import {
  activate,
  cashOf,
  expectIntegrity,
  grantShares,
  holdingOf,
  limit,
  makeUser,
  market,
  newPool,
  place,
  resetDatabase,
  STARTING_CASH,
  tradesOf,
} from './helpers.js';

const pool = newPool();
const T = 'SNIG';

beforeEach(async () => {
  await resetDatabase(pool);
  await activate(pool, T, 1000n);
});
afterAll(() => pool.end());

describe('funds and inventory safety', () => {
  it('rejects a limit buy exceeding available cash and records the rejection', async () => {
    const b = await makeUser(pool);
    const r = await place(pool, limit(b, T, 'BUY', 1001n, 1000n)); // $10,010 > $10,000
    expect(r.order.status).toBe('REJECTED');
    expect(r.order.rejectReason).toBe('INSUFFICIENT_FUNDS');
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH, reserved: 0n });
    const ok = await place(pool, limit(b, T, 'BUY', 1000n, 1000n)); // exactly $10,000
    expect(ok.order.status).toBe('OPEN');
  });

  it('rejects a sell exceeding owned shares (limit and market)', async () => {
    const s = await makeUser(pool);
    await grantShares(pool, T, s, 5n);
    expect((await place(pool, limit(s, T, 'SELL', 6n, 1000n))).order.rejectReason).toBe('INSUFFICIENT_SHARES');
    expect((await place(pool, market(s, T, 'SELL', 6n))).order.rejectReason).toBe('INSUFFICIENT_SHARES');
    const none = await makeUser(pool);
    expect((await place(pool, limit(none, T, 'SELL', 1n, 1000n))).order.rejectReason).toBe('INSUFFICIENT_SHARES');
  });

  it('prevents oversubscription of cash through multiple resting buys', async () => {
    const b = await makeUser(pool);
    expect((await place(pool, limit(b, T, 'BUY', 6n, 100_000n))).order.status).toBe('OPEN'); // $6,000 reserved
    expect((await place(pool, limit(b, T, 'BUY', 4n, 100_000n))).order.status).toBe('OPEN'); // $4,000 reserved
    const third = await place(pool, limit(b, T, 'BUY', 1n, 1n)); // $0.01 more
    expect(third.order.rejectReason).toBe('INSUFFICIENT_FUNDS');
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH, reserved: STARTING_CASH });
    // Market buy budget is also checked against AVAILABLE cash.
    expect((await place(pool, market(b, T, 'BUY', 1n, 1n))).order.rejectReason).toBe('INSUFFICIENT_FUNDS');
    await expectIntegrity(pool);
  });

  it('prevents oversubscription of shares through multiple resting sells', async () => {
    const s = await makeUser(pool);
    await grantShares(pool, T, s, 10n);
    expect((await place(pool, limit(s, T, 'SELL', 7n, 2000n))).order.status).toBe('OPEN');
    expect((await place(pool, limit(s, T, 'SELL', 3n, 2100n))).order.status).toBe('OPEN');
    expect((await place(pool, limit(s, T, 'SELL', 1n, 2200n))).order.rejectReason).toBe('INSUFFICIENT_SHARES');
    expect((await place(pool, market(s, T, 'SELL', 1n))).order.rejectReason).toBe('INSUFFICIENT_SHARES');
    expect(await holdingOf(pool, s, T)).toEqual({ qty: 10n, reserved: 10n });
    await expectIntegrity(pool);
  });

  it('releases unused reserve when a buy executes below its limit (price improvement)', async () => {
    const [b, s] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 10n);
    await place(pool, limit(s, T, 'SELL', 4n, 900n));
    const r = await place(pool, limit(b, T, 'BUY', 10n, 1000n));
    // 4 filled @ 900 = 3600 paid; 6 remain resting reserving 6*1000. Reserved for the
    // filled part (4*1000=4000) is released; only 3600 actually left the account.
    expect(r.order.status).toBe('PARTIALLY_FILLED');
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH - 3600n, reserved: 6000n });
    expect(r.order.reservedCents).toBe(6000);
    await cancelOrder(pool, { orderId: r.order.id, actorUserId: b });
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH - 3600n, reserved: 0n });
    await expectIntegrity(pool);
  });

  it('resting bid filled by an incoming sell consumes exactly its own reservation', async () => {
    const [b, s] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 10n);
    await place(pool, limit(b, T, 'BUY', 10n, 1000n));
    await place(pool, limit(s, T, 'SELL', 10n, 500n));
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH - 10_000n, reserved: 0n });
    expect(await cashOf(pool, s)).toEqual({ cash: STARTING_CASH + 10_000n, reserved: 0n });
    await expectIntegrity(pool);
  });

  it('rejects invalid shapes before touching the database', async () => {
    const b = await makeUser(pool);
    await expect(placeOrder(pool, { ...limit(b, T, 'BUY', 0n, 100n) })).rejects.toMatchObject({ code: 'INVALID_ORDER' });
    await expect(placeOrder(pool, { ...limit(b, T, 'BUY', 1n, 0n) })).rejects.toMatchObject({ code: 'INVALID_ORDER' });
    await expect(placeOrder(pool, market(b, T, 'BUY', 1n))).rejects.toMatchObject({ code: 'INVALID_ORDER' }); // no budget
  });
});

describe('self-trade prevention (cancel incoming remainder)', () => {
  it('an incoming order never executes against its owner resting order', async () => {
    const u = await makeUser(pool);
    await grantShares(pool, T, u, 10n);
    await place(pool, limit(u, T, 'SELL', 10n, 1000n));
    const r = await place(pool, limit(u, T, 'BUY', 5n, 1000n));
    expect(r.fills).toEqual([]);
    expect(r.order.status).toBe('CANCELLED');
    expect(r.order.cancelReason).toBe('SELF_TRADE_PREVENTION');
    expect(await cashOf(pool, u)).toEqual({ cash: STARTING_CASH, reserved: 0n });
    expect(await tradesOf(pool, T)).toEqual([]);
    await expectIntegrity(pool);
  });

  it('does not jump past a higher-priority own order to reach other liquidity', async () => {
    const [u, other] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, u, 10n);
    await grantShares(pool, T, other, 10n);
    await place(pool, limit(other, T, 'SELL', 2n, 990n)); // best
    await place(pool, limit(u, T, 'SELL', 5n, 1000n)); // own, next in priority
    await place(pool, limit(other, T, 'SELL', 5n, 1000n)); // same price, later -> must NOT be reached
    await place(pool, limit(other, T, 'SELL', 5n, 1010n));
    const r = await place(pool, limit(u, T, 'BUY', 10n, 1010n));
    expect(r.fills.map((f) => [f.priceCents, f.quantity])).toEqual([[990, 2]]);
    expect(r.order.status).toBe('CANCELLED');
    expect(r.order.cancelReason).toBe('SELF_TRADE_PREVENTION');
    expect(r.order.filledQuantity).toBe(2);
    // The incoming remainder did not rest: book is not crossed and the own ask is intact.
    const book = await getOrderBook(pool, T);
    expect(book.bids).toEqual([]);
    expect(book.asks[0]).toEqual({ priceCents: 1000, quantity: 10, orders: 2 });
    expect(await cashOf(pool, u)).toEqual({ cash: STARTING_CASH - 1980n, reserved: 0n });
    await expectIntegrity(pool);
  });

  it('market orders stop at the owner resting order as well', async () => {
    const [u, other] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, u, 1n);
    await place(pool, limit(other, T, 'BUY', 1n, 1100n));
    await place(pool, limit(u, T, 'BUY', 1n, 1050n));
    await place(pool, limit(other, T, 'BUY', 1n, 1000n));
    const r = await place(pool, market(u, T, 'SELL', 1n));
    expect(r.fills.map((f) => f.priceCents)).toEqual([1100]);
    const u2 = await makeUser(pool);
    await grantShares(pool, T, u2, 2n);
    // other's remaining bid at 1000 is below u's 1050 bid; u selling now hits its own bid first.
    await grantShares(pool, T, u, 1n);
    const r2 = await place(pool, market(u, T, 'SELL', 1n));
    expect(r2.fills).toEqual([]);
    expect(r2.order.cancelReason).toBe('SELF_TRADE_PREVENTION');
    await expectIntegrity(pool);
  });
});
