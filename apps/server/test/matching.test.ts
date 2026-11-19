import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cancelOrder } from '../src/engine/matching.js';
import { getOrderBook } from '../src/engine/book.js';
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
const T = 'JINK';

beforeEach(async () => {
  await resetDatabase(pool);
  await activate(pool, T, 1000n);
});
afterAll(() => pool.end());

describe('price-time priority', () => {
  it('fills the lowest ask first, then earliest at equal price, at resting prices', async () => {
    const [s1, s2, s3, s4, buyer] = [await makeUser(pool), await makeUser(pool), await makeUser(pool), await makeUser(pool), await makeUser(pool)];
    for (const s of [s1, s2, s3, s4]) await grantShares(pool, T, s, 100n);
    const a1 = await place(pool, limit(s1, T, 'SELL', 10n, 1010n)); // worse price, earliest
    const a2 = await place(pool, limit(s2, T, 'SELL', 10n, 1000n)); // best price, earlier
    const a3 = await place(pool, limit(s3, T, 'SELL', 10n, 1000n)); // best price, later
    const a4 = await place(pool, limit(s4, T, 'SELL', 10n, 1020n));
    expect(a2.order.seq).toBeLessThan(a3.order.seq);

    const r = await place(pool, limit(buyer, T, 'BUY', 25n, 1015n));
    expect(r.order.status).toBe('FILLED');
    expect(r.fills.map((f) => [f.counterpartyOrderId, f.priceCents, f.quantity])).toEqual([
      [a2.order.id, 1000, 10],
      [a3.order.id, 1000, 10],
      [a1.order.id, 1010, 5],
    ]);
    // Buyer paid resting prices: 20*1000 + 5*1010 = 25050; reserved nothing after fill.
    expect(await cashOf(pool, buyer)).toEqual({ cash: STARTING_CASH - 25050n, reserved: 0n });
    const book = await getOrderBook(pool, T);
    expect(book.asks).toEqual([
      { priceCents: 1010, quantity: 5, orders: 1 },
      { priceCents: 1020, quantity: 10, orders: 1 },
    ]);
    expect(a4.order.status).toBe('OPEN');
    await expectIntegrity(pool);
  });

  it('fills the highest bid first, then earliest at equal price', async () => {
    const [b1, b2, b3, seller] = [await makeUser(pool), await makeUser(pool), await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, seller, 100n);
    const o1 = await place(pool, limit(b1, T, 'BUY', 5n, 990n));
    const o2 = await place(pool, limit(b2, T, 'BUY', 5n, 995n));
    const o3 = await place(pool, limit(b3, T, 'BUY', 5n, 995n));
    const r = await place(pool, limit(seller, T, 'SELL', 12n, 980n));
    expect(r.fills.map((f) => [f.counterpartyOrderId, f.priceCents, f.quantity])).toEqual([
      [o2.order.id, 995, 5],
      [o3.order.id, 995, 5],
      [o1.order.id, 990, 2],
    ]);
    // Seller receives resting bid prices, not their own lower limit.
    expect((await cashOf(pool, seller)).cash).toBe(STARTING_CASH + 995n * 10n + 990n * 2n);
    await expectIntegrity(pool);
  });

  it('does not match when bid < ask; both rest', async () => {
    const [b, s] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 10n);
    await place(pool, limit(s, T, 'SELL', 10n, 1001n));
    const r = await place(pool, limit(b, T, 'BUY', 10n, 1000n));
    expect(r.order.status).toBe('OPEN');
    expect(r.fills).toEqual([]);
    const book = await getOrderBook(pool, T);
    expect(book.bestBidCents).toBe(1000);
    expect(book.bestAskCents).toBe(1001);
    expect(book.spreadCents).toBe(1);
    await expectIntegrity(pool);
  });

  it('matches when bid == ask', async () => {
    const [b, s] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 10n);
    await place(pool, limit(s, T, 'SELL', 10n, 1000n));
    const r = await place(pool, limit(b, T, 'BUY', 10n, 1000n));
    expect(r.order.status).toBe('FILLED');
  });

  it('a limit order into an empty book rests with full reservation', async () => {
    const b = await makeUser(pool);
    const r = await place(pool, limit(b, T, 'BUY', 7n, 1234n));
    expect(r.order.status).toBe('OPEN');
    expect(r.order.reservedCents).toBe(7 * 1234);
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH, reserved: 7n * 1234n });
    const s = await makeUser(pool);
    await grantShares(pool, T, s, 5n);
    const sr = await place(pool, limit(s, T, 'SELL', 5n, 2000n));
    expect(sr.order.status).toBe('OPEN');
    expect(await holdingOf(pool, s, T)).toEqual({ qty: 5n, reserved: 5n });
    await expectIntegrity(pool);
  });
});

describe('partial and multiple fills', () => {
  it('partially fills a resting order and leaves the remainder with correct reservation', async () => {
    const [b, s] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 50n);
    const ask = await place(pool, limit(s, T, 'SELL', 50n, 1000n));
    const r = await place(pool, limit(b, T, 'BUY', 20n, 1000n));
    expect(r.order.status).toBe('FILLED');
    const book = await getOrderBook(pool, T);
    expect(book.asks).toEqual([{ priceCents: 1000, quantity: 30, orders: 1 }]);
    expect(await holdingOf(pool, s, T)).toEqual({ qty: 30n, reserved: 30n });
    const ask2 = await pool.query(`SELECT status, filled_quantity FROM orders WHERE id = $1`, [ask.order.id]);
    expect(ask2.rows[0]).toEqual({ status: 'PARTIALLY_FILLED', filled_quantity: 20n });
    await expectIntegrity(pool);
  });

  it('incoming order sweeps multiple counterparties and rests the remainder', async () => {
    const sellers = [await makeUser(pool), await makeUser(pool), await makeUser(pool)];
    for (const s of sellers) {
      await grantShares(pool, T, s, 5n);
      await place(pool, limit(s, T, 'SELL', 5n, 1000n));
    }
    const b = await makeUser(pool);
    const r = await place(pool, limit(b, T, 'BUY', 20n, 1000n));
    expect(r.fills).toHaveLength(3);
    expect(r.order.status).toBe('PARTIALLY_FILLED');
    expect(r.order.filledQuantity).toBe(15);
    expect(r.order.reservedCents).toBe(5 * 1000);
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH - 15_000n, reserved: 5_000n });
    expect(await holdingOf(pool, b, T)).toEqual({ qty: 15n, reserved: 0n });
    const trades = await tradesOf(pool, T);
    expect(trades.map((t) => t.seller_id)).toEqual(sellers);
    expect((await pool.query(`SELECT last_price_cents FROM securities WHERE ticker = $1`, [T])).rows[0].last_price_cents).toBe(1000n);
    await expectIntegrity(pool);
  });
});

describe('market orders', () => {
  it('market buy into an empty book is cancelled, nothing changes, last price untouched', async () => {
    const b = await makeUser(pool);
    const r = await place(pool, market(b, T, 'BUY', 10n, 50_000n));
    expect(r.order.status).toBe('CANCELLED');
    expect(r.order.cancelReason).toBe('NO_LIQUIDITY');
    expect(r.fills).toEqual([]);
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH, reserved: 0n });
    expect((await pool.query(`SELECT last_price_cents FROM securities WHERE ticker = $1`, [T])).rows[0].last_price_cents).toBeNull();
    expect((await getOrderBook(pool, T)).bids).toEqual([]);
  });

  it('market sell with insufficient liquidity fills what exists and cancels the rest (never rests)', async () => {
    const [b, s] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 100n);
    await place(pool, limit(b, T, 'BUY', 4n, 900n));
    const r = await place(pool, market(s, T, 'SELL', 10n));
    expect(r.order.status).toBe('CANCELLED');
    expect(r.order.filledQuantity).toBe(4);
    expect(r.order.cancelReason).toBe('NO_LIQUIDITY');
    expect(r.order.reservedQuantity).toBe(0);
    expect(await holdingOf(pool, s, T)).toEqual({ qty: 96n, reserved: 0n });
    expect((await getOrderBook(pool, T)).asks).toEqual([]);
    await expectIntegrity(pool);
  });

  it('market buy never spends more than maxSpendCents', async () => {
    const [s1, s2, b] = [await makeUser(pool), await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s1, 10n);
    await grantShares(pool, T, s2, 10n);
    await place(pool, limit(s1, T, 'SELL', 10n, 1000n));
    await place(pool, limit(s2, T, 'SELL', 10n, 1500n));
    // Budget 13,000: 10 @ 1000 = 10,000, then floor(3000/1500) = 2 @ 1500.
    const r = await place(pool, market(b, T, 'BUY', 20n, 13_000n));
    expect(r.fills.map((f) => [f.priceCents, f.quantity])).toEqual([
      [1000, 10],
      [1500, 2],
    ]);
    expect(r.order.filledNotionalCents).toBe(13_000);
    expect(r.order.status).toBe('CANCELLED');
    expect(r.order.cancelReason).toBe('MAX_SPEND_REACHED');
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH - 13_000n, reserved: 0n });
    await expectIntegrity(pool);
  });

  it('market buy is rejected when budget exceeds available cash', async () => {
    const b = await makeUser(pool);
    const r = await place(pool, market(b, T, 'BUY', 1n, STARTING_CASH + 1n));
    expect(r.order.status).toBe('REJECTED');
    expect(r.order.rejectReason).toBe('INSUFFICIENT_FUNDS');
  });
});

describe('cancellation', () => {
  it('cancel after partial fill releases exactly the remaining reservation', async () => {
    const [b, s] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 3n);
    const bid = await place(pool, limit(b, T, 'BUY', 10n, 1000n));
    await place(pool, limit(s, T, 'SELL', 3n, 1000n));
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH - 3000n, reserved: 7000n });
    const c = await cancelOrder(pool, { orderId: bid.order.id, actorUserId: b });
    expect(c.status).toBe('CANCELLED');
    expect(c.filledQuantity).toBe(3);
    expect(c.reservedCents).toBe(0);
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH - 3000n, reserved: 0n });
    await expect(cancelOrder(pool, { orderId: bid.order.id, actorUserId: b })).rejects.toMatchObject({ code: 'ORDER_NOT_OPEN' });
    await expectIntegrity(pool);
  });

  it('cancel of a sell releases reserved shares; other users cannot cancel it', async () => {
    const [s, other] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 10n);
    const ask = await place(pool, limit(s, T, 'SELL', 10n, 1100n));
    await expect(cancelOrder(pool, { orderId: ask.order.id, actorUserId: other })).rejects.toMatchObject({ statusCode: 404 });
    await cancelOrder(pool, { orderId: ask.order.id, actorUserId: s });
    expect(await holdingOf(pool, s, T)).toEqual({ qty: 10n, reserved: 0n });
    expect((await getOrderBook(pool, T)).asks).toEqual([]);
  });
});
