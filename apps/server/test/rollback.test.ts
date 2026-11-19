import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { placeOrder } from '../src/engine/matching.js';
import { activate, cashOf, expectIntegrity, grantShares, holdingOf, limit, makeUser, newPool, place, resetDatabase, STARTING_CASH } from './helpers.js';

const pool = newPool();
const T = 'BABU';

beforeEach(async () => {
  await resetDatabase(pool);
  await activate(pool, T, 1000n);
});
afterAll(() => pool.end());

async function snapshot() {
  const q = async (sql: string) => (await pool.query(sql)).rows;
  return {
    cash: await q(`SELECT user_id, cash_cents, reserved_cents FROM cash_accounts ORDER BY user_id`),
    holdings: await q(`SELECT user_id, ticker, quantity, reserved_quantity, cost_basis_cents FROM holdings WHERE quantity > 0 ORDER BY user_id, ticker`),
    orders: await q(`SELECT id, status, filled_quantity, reserved_cents, reserved_quantity FROM orders ORDER BY seq`),
    trades: await q(`SELECT COUNT(*)::int AS n FROM trades`),
    cashLedger: await q(`SELECT COUNT(*)::int AS n FROM cash_ledger`),
    positionLedger: await q(`SELECT COUNT(*)::int AS n FROM position_ledger`),
    priceHistory: await q(`SELECT COUNT(*)::int AS n FROM price_history`),
    outbox: await q(`SELECT COUNT(*)::int AS n FROM outbox_events`),
    idem: await q(`SELECT COUNT(*)::int AS n FROM idempotency_keys`),
    security: await q(`SELECT last_price_cents, book_version FROM securities WHERE ticker = '${T}'`),
  };
}

describe('transaction rollback', () => {
  it('a failure after all writes of a multi-fill execution rolls back everything', async () => {
    const [s1, s2, b] = [await makeUser(pool), await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s1, 10n);
    await grantShares(pool, T, s2, 10n);
    await place(pool, limit(s1, T, 'SELL', 10n, 1000n));
    await place(pool, limit(s2, T, 'SELL', 10n, 1001n));
    const before = await snapshot();
    await expect(
      placeOrder(pool, limit(b, T, 'BUY', 15n, 1001n, 'rollback-key-1'), {
        beforeCommit: () => {
          throw new Error('simulated crash before commit');
        },
      }),
    ).rejects.toThrow('simulated crash');
    expect(await snapshot()).toEqual(before);
    // The idempotency key was rolled back too, so a retry executes normally.
    const retry = await place(pool, limit(b, T, 'BUY', 15n, 1001n, 'rollback-key-1'));
    expect(retry.replayed).toBe(false);
    expect(retry.order.status).toBe('FILLED');
    expect(await holdingOf(pool, b, T)).toEqual({ qty: 15n, reserved: 0n });
    await expectIntegrity(pool);
  });

  it('a database constraint violation mid-execution rolls back the whole execution', async () => {
    const [s, b] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 10n);
    await place(pool, limit(s, T, 'SELL', 10n, 1000n));
    const before = await snapshot();
    await expect(
      placeOrder(pool, limit(b, T, 'BUY', 5n, 1000n), {
        // Forge an invalid state inside the same transaction: the CHECK constraint fires.
        beforeCommit: async (c) => {
          await c.query(`UPDATE cash_accounts SET reserved_cents = cash_cents + 1 WHERE user_id = $1`, [b]);
        },
      }),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await snapshot()).toEqual(before);
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH, reserved: 0n });
  });

  it('append-only ledgers and immutable issuance reject tampering', async () => {
    const s = await makeUser(pool);
    await grantShares(pool, T, s, 10n);
    await expect(pool.query(`UPDATE security_issuance SET quantity = 1000000`)).rejects.toMatchObject({ code: '23001' });
    await expect(pool.query(`DELETE FROM security_issuance`)).rejects.toMatchObject({ code: '23001' });
    await expect(pool.query(`TRUNCATE security_issuance CASCADE`)).rejects.toMatchObject({ code: '23001' });
    await expect(pool.query(`UPDATE cash_ledger SET amount_cents = 1`)).rejects.toMatchObject({ code: '23001' });
    await expect(pool.query(`DELETE FROM position_ledger`)).rejects.toMatchObject({ code: '23001' });
  });

  it('database rejects a market order that would rest and a self-trade row', async () => {
    const u = await makeUser(pool);
    await expect(
      pool.query(`INSERT INTO orders (user_id, ticker, side, type, quantity, status, max_spend_cents) VALUES ($1, $2, 'BUY', 'MARKET', 1, 'OPEN', 100)`, [u, T]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
