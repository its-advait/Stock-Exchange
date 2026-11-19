import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { placeOrder } from '../src/engine/matching.js';
import { cancelOrder } from '../src/engine/matching.js';
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

const pool = newPool(40);
const T = 'GANDH';

beforeEach(async () => {
  await resetDatabase(pool);
  await activate(pool, T, 1000n);
});
afterAll(() => pool.end());

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('idempotency', () => {
  it('replays the original response for a retried request with the same key', async () => {
    const [b, s] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 10n);
    await place(pool, limit(s, T, 'SELL', 10n, 1000n));
    const req = limit(b, T, 'BUY', 5n, 1000n, 'retry-key-0001');
    const first = await placeOrder(pool, req);
    const second = await placeOrder(pool, req);
    expect(first.body.replayed).toBe(false);
    expect(second.body.replayed).toBe(true);
    expect(second.httpStatus).toBe(first.httpStatus);
    expect(second.body.order.id).toBe(first.body.order.id);
    expect(await tradesOf(pool, T)).toHaveLength(1);
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH - 5000n, reserved: 0n });
  });

  it('concurrent duplicate submissions execute exactly once', async () => {
    const [b, s] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 100n);
    await place(pool, limit(s, T, 'SELL', 100n, 1000n));
    const req = limit(b, T, 'BUY', 3n, 1000n, 'dup-key-concurrent');
    const results = await Promise.all(Array.from({ length: 10 }, () => placeOrder(pool, req)));
    expect(new Set(results.map((r) => r.body.order.id)).size).toBe(1);
    expect(results.filter((r) => !r.body.replayed)).toHaveLength(1);
    expect(await tradesOf(pool, T)).toHaveLength(1);
    expect(await holdingOf(pool, b, T)).toEqual({ qty: 3n, reserved: 0n });
    await expectIntegrity(pool);
  });

  it('rejects reuse of a key with a different request body', async () => {
    const b = await makeUser(pool);
    await place(pool, limit(b, T, 'BUY', 1n, 900n, 'reuse-key-xyz'));
    await expect(placeOrder(pool, limit(b, T, 'BUY', 2n, 900n, 'reuse-key-xyz'))).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  });

  it('keys are scoped per user', async () => {
    const [a, b] = [await makeUser(pool), await makeUser(pool)];
    const ra = await place(pool, limit(a, T, 'BUY', 1n, 900n, 'shared-key-123'));
    const rb = await place(pool, limit(b, T, 'BUY', 1n, 900n, 'shared-key-123'));
    expect(ra.order.id).not.toBe(rb.order.id);
    expect(rb.replayed).toBe(false);
  });
});

describe('concurrency', () => {
  it('many simultaneous orders from one account cannot double-spend', async () => {
    const b = await makeUser(pool);
    // 20 concurrent bids of $1,000 each against a $10,000 balance: exactly 10 can be accepted.
    const results = await Promise.all(Array.from({ length: 20 }, () => place(pool, limit(b, T, 'BUY', 1n, 100_000n))));
    expect(results.filter((r) => r.order.status === 'OPEN')).toHaveLength(10);
    expect(results.filter((r) => r.order.rejectReason === 'INSUFFICIENT_FUNDS')).toHaveLength(10);
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH, reserved: STARTING_CASH });
    await expectIntegrity(pool);
  });

  it('many simultaneous sells from one account cannot oversell', async () => {
    const s = await makeUser(pool);
    await grantShares(pool, T, s, 7n);
    const results = await Promise.all([
      ...Array.from({ length: 10 }, () => place(pool, limit(s, T, 'SELL', 1n, 1500n))),
      ...Array.from({ length: 5 }, () => place(pool, market(s, T, 'SELL', 1n))),
    ]);
    // Market sells find no bids (cancelled, consume nothing). Exactly 7 of the 10 limit sells can rest.
    const resting = results.filter((r) => r.order.status === 'OPEN');
    expect(resting).toHaveLength(7);
    expect(results.filter((r) => r.order.type === 'LIMIT' && r.order.rejectReason === 'INSUFFICIENT_SHARES')).toHaveLength(3);
    const h = await holdingOf(pool, s, T);
    expect(h).toEqual({ qty: 7n, reserved: 7n });
    await expectIntegrity(pool);
  });

  it('multiple accounts competing for the same resting order: exactly one wins each share', async () => {
    const s = await makeUser(pool);
    await grantShares(pool, T, s, 5n);
    const ask = await place(pool, limit(s, T, 'SELL', 5n, 1000n));
    const buyers = await Promise.all(Array.from({ length: 12 }, () => makeUser(pool)));
    const results = await Promise.all(buyers.map((b) => place(pool, market(b, T, 'BUY', 1n, 5000n))));
    const filled = results.filter((r) => r.order.status === 'FILLED');
    expect(filled).toHaveLength(5);
    expect(results.filter((r) => r.order.cancelReason === 'NO_LIQUIDITY')).toHaveLength(7);
    const trades = await tradesOf(pool, T);
    expect(trades).toHaveLength(5);
    expect(trades.every((t) => t.maker_order_id === ask.order.id)).toBe(true);
    expect(await holdingOf(pool, s, T)).toEqual({ qty: 0n, reserved: 0n });
    await expectIntegrity(pool);
  });

  it('randomized concurrent trading conserves cash and shares across tickers (deterministic seed)', async () => {
    const tickers = ['GANDH', 'BABU', 'MUNCH'];
    for (const t of tickers.slice(1)) await activate(pool, t, 500n);
    const users = await Promise.all(Array.from({ length: 8 }, () => makeUser(pool)));
    for (const u of users) for (const t of tickers) await grantShares(pool, t, u, 50n);
    const rand = rng(20261118);
    const ops: (() => Promise<unknown>)[] = [];
    for (let i = 0; i < 400; i++) {
      const u = users[Math.floor(rand() * users.length)]!;
      const t = tickers[Math.floor(rand() * tickers.length)]!;
      const side = rand() < 0.5 ? 'BUY' : 'SELL';
      const qty = BigInt(1 + Math.floor(rand() * 10));
      const kind = rand();
      if (kind < 0.75) {
        const price = BigInt(450 + Math.floor(rand() * 100));
        ops.push(() => place(pool, limit(u, t, side, qty, price)));
      } else if (kind < 0.9) {
        ops.push(() => place(pool, market(u, t, side, qty, side === 'BUY' ? 5_000n : undefined)));
      } else {
        ops.push(async () => {
          const o = await pool.query<{ id: string }>(
            `SELECT id FROM orders WHERE user_id = $1 AND status IN ('OPEN','PARTIALLY_FILLED') ORDER BY seq LIMIT 1`,
            [u],
          );
          if (o.rows[0]) await cancelOrder(pool, { orderId: o.rows[0].id, actorUserId: u }).catch((e) => {
            if (e.code !== 'ORDER_NOT_OPEN') throw e;
          });
        });
      }
    }
    // Run in waves of 25 concurrent operations.
    for (let i = 0; i < ops.length; i += 25) await Promise.all(ops.slice(i, i + 25).map((f) => f()));

    const tradesCount = (await pool.query(`SELECT COUNT(*)::int AS n FROM trades`)).rows[0].n;
    expect(tradesCount).toBeGreaterThan(20);
    const totalCash = (await pool.query(`SELECT SUM(cash_cents)::bigint AS s FROM cash_accounts c JOIN users u ON u.id = c.user_id WHERE u.account_type = 'HUMAN'`)).rows[0].s;
    expect(totalCash).toBe(STARTING_CASH * 8n);
    for (const t of tickers) {
      const held = (await pool.query(`SELECT SUM(quantity)::bigint AS s FROM holdings WHERE ticker = $1`, [t])).rows[0].s;
      expect(held).toBe(400n);
    }
    await expectIntegrity(pool);
  });
});
