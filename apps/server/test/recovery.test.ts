import { describe, expect, it } from 'vitest';
import { getOrderBook } from '../src/engine/book.js';
import { OutboxRelay } from '../src/realtime/outboxRelay.js';
import { activate, cashOf, expectIntegrity, grantShares, holdingOf, limit, makeUser, newPool, place, resetDatabase, STARTING_CASH } from './helpers.js';

const T = 'STHAN';

describe('recovery after process restart', () => {
  it('book, balances and reservations survive a restart and matching continues', async () => {
    // "Process 1"
    let pool = newPool();
    await resetDatabase(pool);
    await activate(pool, T, 1000n);
    const [b, s] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 20n);
    await place(pool, limit(s, T, 'SELL', 10n, 1010n));
    await place(pool, limit(s, T, 'SELL', 10n, 1020n));
    await place(pool, limit(b, T, 'BUY', 5n, 990n));
    const bookBefore = await getOrderBook(pool, T);
    await pool.end(); // crash/exit: no in-memory state survives

    // "Process 2": brand-new pool, nothing cached.
    pool = newPool();
    expect(await getOrderBook(pool, T)).toEqual(bookBefore);
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH, reserved: 4950n });
    expect(await holdingOf(pool, s, T)).toEqual({ qty: 20n, reserved: 20n });
    const r = await place(pool, limit(b, T, 'BUY', 15n, 1020n));
    expect(r.fills.map((f) => [f.priceCents, f.quantity])).toEqual([
      [1010, 10],
      [1020, 5],
    ]);
    // Acceptance sequence keeps increasing across restarts.
    const seqs = (await pool.query(`SELECT seq FROM orders ORDER BY created_at, seq`)).rows.map((x) => x.seq as bigint);
    expect([...seqs].sort((a, b) => (a < b ? -1 : 1))).toEqual(seqs);
    await expectIntegrity(pool);
    await pool.end();
  });

  it('events committed but not yet published are delivered by the relay after restart, exactly in order', async () => {
    let pool = newPool();
    await resetDatabase(pool);
    await activate(pool, T, 1000n);
    const [b, s] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 5n);
    await place(pool, limit(s, T, 'SELL', 5n, 1000n));
    await place(pool, limit(b, T, 'BUY', 5n, 1000n));
    const pending = (await pool.query(`SELECT COUNT(*)::int AS n FROM outbox_events WHERE published_at IS NULL`)).rows[0].n;
    expect(pending).toBeGreaterThan(0);
    await pool.end(); // process died before the relay ran

    pool = newPool();
    const emitted: { room: string; event: string; payload: Record<string, unknown> }[] = [];
    const relay = new OutboxRelay(pool, { emit: (room, event, payload) => emitted.push({ room, event, payload }) }, { pollMs: 10_000 });
    await relay.start();
    await relay.kick();
    await relay.stop();
    expect(emitted).toHaveLength(pending);
    const ids = emitted.map((e) => e.payload.eventId as number);
    expect([...ids].sort((x, y) => x - y)).toEqual(ids);
    expect(emitted.filter((e) => e.event === 'trade' && e.room === `ticker:${T}`)).toHaveLength(1);
    expect(emitted.some((e) => e.event === 'order' && e.room === `user:${b}`)).toBe(true);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM outbox_events WHERE published_at IS NULL`)).rows[0].n).toBe(0);
    await pool.end();
  });

  it('rolled-back transactions never produce outbox events', async () => {
    const pool = newPool();
    await resetDatabase(pool);
    await activate(pool, T, 1000n);
    const u = await makeUser(pool);
    const { placeOrder } = await import('../src/engine/matching.js');
    await expect(
      placeOrder(pool, limit(u, T, 'BUY', 1n, 1000n), {
        beforeCommit: () => {
          throw new Error('boom');
        },
      }),
    ).rejects.toThrow('boom');
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM outbox_events`)).rows[0].n).toBe(0);
    await pool.end();
  });
});
