import { ACTIVE_RANKINGS, CANONICAL_TICKERS, STOCK_UNIVERSE, simulatedPriceFromActivity } from '@aez/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { placeOrder } from '../src/engine/matching.js';
import { buildHistoryPlan, DEFAULT_HISTORY_OPTIONS, eligibleTickers, generateHistory } from '../src/services/historyGenerator.js';
import { leaderboardBoards } from '../src/services/insights.js';
import { getSecurity } from '../src/services/market.js';
import { leaderboard } from '../src/services/portfolio.js';
import { authenticate } from '../src/services/sessions.js';
import { STARTING_CASH, expectIntegrity, makeUser, newPool, resetDatabase } from './helpers.js';

const OPTS = { ...DEFAULT_HISTORY_OPTIONS, startingCashCents: STARTING_CASH };

describe('Active Rankings data', () => {
  it('covers every canonical brother exactly once, ranks 1..45', () => {
    expect(ACTIVE_RANKINGS).toHaveLength(STOCK_UNIVERSE.length);
    expect(new Set(ACTIVE_RANKINGS.map((a) => a.ticker))).toEqual(new Set(CANONICAL_TICKERS));
    expect(ACTIVE_RANKINGS.map((a) => a.activityRank)).toEqual(STOCK_UNIVERSE.map((_s, i) => i + 1));
    for (const a of ACTIVE_RANKINGS) expect(a.writeup.length).toBeGreaterThan(10);
  });

  it('prices are positive whole cents between $8 and $60, highest for #1', () => {
    const prices = ACTIVE_RANKINGS.map((a) => simulatedPriceFromActivity(a));
    for (const p of prices) {
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(800);
      expect(p).toBeLessThanOrEqual(6000);
    }
    expect(prices[0]).toBe(Math.max(...prices));
  });
});

describe('history plan', () => {
  it('is deterministic and gives every brother an opening tranche plus a walk', () => {
    const tickers = [...CANONICAL_TICKERS];
    const a = buildHistoryPlan(tickers, OPTS);
    const b = buildHistoryPlan(tickers, OPTS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const steps = a.rounds.flat();
    for (const t of tickers) {
      const mine = steps.filter((s) => s.ticker === t);
      expect(mine.filter((s) => s.kind === 'IPO').reduce((n, s) => n + s.quantity, 0)).toBe(20);
      expect(mine.filter((s) => s.kind === 'WALK').length).toBeGreaterThanOrEqual(OPTS.minSteps - 1);
    }
    const busiest = a.tickers.find((t) => t.activity.activityRank === 1)!;
    const quietest = a.tickers.find((t) => t.activity.activityRank === 45)!;
    expect(busiest.walkSteps).toBeGreaterThan(quietest.walkSteps);
    expect(busiest.targetCents).toBeGreaterThan(busiest.ipoCents); // active brothers trend up
    expect(quietest.targetCents).toBeLessThan(quietest.ipoCents); // quiet ones drift down
  });
});

describe('generateHistory (real engine)', () => {
  let pool: pg.Pool;
  let adminId: string;

  beforeAll(async () => {
    pool = newPool();
    await resetDatabase(pool);
    adminId = await makeUser(pool, 'hist_admin', 'ADMIN');
    await makeUser(pool, 'hist_human');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('gives all 45 brothers a SIMULATED price and real executions, conserving the ledger', async () => {
    const res = await generateHistory(pool, adminId, OPTS);
    expect(res.tickers).toBe(45);
    expect(res.aborted).toEqual([]);
    expect(res.trades).toBeGreaterThan(45 * 8);

    const perTicker = await pool.query<{ ticker: string; n: string }>(`SELECT ticker, COUNT(*) AS n FROM trades GROUP BY ticker`);
    expect(perTicker.rows).toHaveLength(45);
    for (const r of perTicker.rows) expect(Number(r.n)).toBeGreaterThanOrEqual(8);

    // Every execution is between simulation desks and/or the market maker: no human was touched.
    const humans = await pool.query(
      `SELECT 1 FROM trades t JOIN users u ON u.id IN (t.buyer_id, t.seller_id) WHERE u.account_type = 'HUMAN' LIMIT 1`,
    );
    expect(humans.rowCount).toBe(0);
    // One price_history row per execution.
    const ph = await pool.query<{ a: string; b: string }>(`SELECT (SELECT COUNT(*) FROM trades) AS a, (SELECT COUNT(*) FROM price_history) AS b`);
    expect(ph.rows[0]!.a).toBe(ph.rows[0]!.b);

    const s = await pool.query<{ ticker: string; status: string; reference_price_source: string; reference_price_cents: string; last_price_cents: string }>(
      `SELECT ticker, status, reference_price_source, reference_price_cents, last_price_cents FROM securities`,
    );
    for (const r of s.rows) {
      expect(r.status).toBe('ACTIVE');
      expect(r.reference_price_source).toBe('ADMIN_SIMULATION');
      const ratio = Number(r.last_price_cents) / Number(r.reference_price_cents);
      expect(ratio).toBeGreaterThan(0.9);
      expect(ratio).toBeLessThan(1.1);
    }

    const detail = await getSecurity(pool, 'ALI');
    expect(detail.tradable).toBe(true);
    expect(detail.referencePriceKind).toBe('SIMULATED');
    expect(detail.simulatedHistory).toBe(true);
    expect(detail.activity).toMatchObject({ rank: 1, of: 45, emailCount: 587, title: 'Mr.' });

    await expectIntegrity(pool);
  }, 120_000);

  it('simulation desks cannot log in and are never ranked', async () => {
    await expect(authenticate(pool, 'aez_sim_desk_1', 'anything at all')).rejects.toThrow();
    const lb = await leaderboard(pool, STARTING_CASH, 100);
    expect(lb.map((e) => e.username)).toEqual(['hist_human']);
    const boards = JSON.stringify(await leaderboardBoards(pool, STARTING_CASH, 50));
    expect(boards).not.toContain('aez_sim_desk');
  });

  it('a re-run with the same seed replays instead of trading again', async () => {
    const before = (await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM trades`)).rows[0]!.n;
    expect(await eligibleTickers(pool)).toHaveLength(45);
    const res = await generateHistory(pool, adminId, OPTS);
    expect(res.trades).toBe(0);
    expect(res.replayed).toBeGreaterThan(0);
    const after = (await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM trades`)).rows[0]!.n;
    expect(after).toBe(before);
    await expectIntegrity(pool);
  }, 120_000);

  it('humans can then trade against the market maker’s resting liquidity', async () => {
    const human = (await pool.query<{ id: string }>(`SELECT id FROM users WHERE username = 'hist_human'`)).rows[0]!.id;
    const ask = (await getSecurity(pool, 'SHVM')).bestAskCents!;
    const out = await placeOrder(pool, {
      userId: human,
      ticker: 'SHVM',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 2n,
      limitPriceCents: BigInt(ask),
      idempotencyKey: 'hist-human-buy-1',
    });
    expect(out.body.order.status).toBe('FILLED');
    await expectIntegrity(pool);
  });
});
