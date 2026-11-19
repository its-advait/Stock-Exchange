/**
 * Simulated opening history, derived from the Active Rankings document.
 *
 * Nothing here bypasses the exchange. For every brother it:
 *   1. sets a SIMULATED reference price from his activity score
 *      (`setSimulatedReference`, audited, labeled SIMULATED everywhere);
 *   2. configures and opens market-maker liquidity (`openLiquidity`), which
 *      issues shares into the immutable issuance ledger and places real quotes,
 *      including a 20-share opening tranche;
 *   3. has the simulation-desk accounts (account_type SIMULATION: cannot log
 *      in, never ranked, funded with the normal $10,000 grant) buy that tranche
 *      and then trade with each other through `placeOrder`, the same matching
 *      engine every human uses.
 *
 * Every price, chart point and volume figure therefore comes from a genuine
 * execution with real cash and share accounting. Higher activity means a
 * higher starting price, more trades and an upward path; low activity starts
 * higher than its reference and drifts down.
 *
 * Deterministic and resumable: the whole plan is computed up front from
 * (seed, eligible tickers), and every order uses a deterministic idempotency
 * key, so re-running with the same seed replays finished steps and continues.
 */
import {
  ACTIVE_RANKINGS,
  ACTIVE_RANKINGS_SOURCE,
  activityScore,
  simulatedPriceFromActivity,
  type ActivityEntry,
  type MarketMakerConfigRequest,
} from '@aez/shared';
import type { Pool } from '../db/pool.js';
import { withTx } from '../db/tx.js';
import { cancelOrder, placeOrder } from '../engine/matching.js';
import { AppError } from '../lib/errors.js';
import { ensureSimulationTraders } from './accounts.js';
import { openLiquidity, upsertMarketMakerConfig } from './marketMaker.js';
import { setSimulatedReference } from './securitiesAdmin.js';

export const SIM_SOURCE_PREFIX = 'SIMULATION: Active Rankings';
const IPO_SHARES = 20;
const BAND = 0.08; // walk stays within ±8% of the reference
const MM_CONFIG = (ipoBps: number): MarketMakerConfigRequest => ({
  inventoryShares: IPO_SHARES + 40 + 80,
  // Opening tranche at the IPO price, then real resting liquidity outside the walk band.
  askLevels: [
    { offsetBps: ipoBps, quantity: IPO_SHARES },
    { offsetBps: 1000, quantity: 40 },
    { offsetBps: 2000, quantity: 80 },
  ],
  bidLevels: [
    { offsetBps: -1000, quantity: 20 },
    { offsetBps: -2000, quantity: 20 },
  ],
  enabled: true,
  note: `Opening liquidity for the simulated history (${ACTIVE_RANKINGS_SOURCE})`,
});

export interface HistoryOptions {
  seed: number;
  bots: number;
  botPrefix: string;
  startingCashCents: bigint;
  /** Maximum walk steps for the most active brother; the least active get `minSteps`. */
  maxSteps: number;
  minSteps: number;
  /** Delay between rounds, so the trades are spread over time. */
  roundDelayMs: number;
  log?: (msg: string) => void;
}

export const DEFAULT_HISTORY_OPTIONS: HistoryOptions = {
  seed: 2026,
  bots: 6,
  botPrefix: 'aez_sim_desk',
  startingCashCents: 1_000_000n,
  maxSteps: 30,
  minSteps: 8,
  roundDelayMs: 0,
};

interface Step {
  kind: 'IPO' | 'WALK';
  ticker: string;
  index: number;
  seller: number | null; // null = buy from the market maker (IPO)
  buyer: number;
  quantity: number;
  priceCents: number;
}

export interface TickerPlan {
  ticker: string;
  activity: ActivityEntry;
  referenceCents: number;
  ipoBps: number;
  ipoCents: number;
  targetCents: number;
  walkSteps: number;
}

export interface HistoryPlan {
  tickers: TickerPlan[];
  /** rounds[r] = steps executed in round r (round 0 = opening tranches). */
  rounds: Step[][];
}

/** mulberry32: small, fast, deterministic. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed: number, s: string): number {
  let h = 2166136261 ^ seed;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function gaussian(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Pure planning: no database access. */
export function buildHistoryPlan(tickers: readonly string[], opts: HistoryOptions): HistoryPlan {
  const pick = rng(hashSeed(opts.seed, 'desk'));
  const cash = Array.from({ length: opts.bots }, () => Number(opts.startingCashCents));
  const shares = Array.from({ length: opts.bots }, () => new Map<string, number>());
  const plans: TickerPlan[] = [];
  const ipoSteps: Step[] = [];
  const paths = new Map<string, number[]>();

  for (const a of ACTIVE_RANKINGS.filter((x) => tickers.includes(x.ticker))) {
    const score = activityScore(a);
    const ref = simulatedPriceFromActivity(a);
    const ipoBps = Math.round((0.5 - score) * 1200);
    // Same rounding as levelPrice(), so the desks' bids meet the market maker's tranche exactly.
    const ipo = Math.max(1, Math.floor((ref * (10000 + ipoBps) + 5000) / 10000));
    const target = Math.round(ref * (1 + (score - 0.5) * 0.1));
    const n = opts.minSteps + Math.round(score * (opts.maxSteps - opts.minSteps));
    const lo = Math.ceil(ref * (1 - BAND));
    const hi = Math.floor(ref * (1 + BAND));
    const r = rng(hashSeed(opts.seed, a.ticker));
    const path: number[] = [];
    let dev = 0;
    for (let j = 0; j < n; j++) {
      const mean = ipo + ((target - ipo) * (j + 1)) / n;
      dev = 0.6 * dev + gaussian(r) * 0.012;
      if (j === n - 1) dev *= 0.3;
      path.push(Math.min(hi, Math.max(lo, Math.round(mean * (1 + dev)))));
    }
    paths.set(a.ticker, path);
    plans.push({ ticker: a.ticker, activity: a, referenceCents: ref, ipoBps, ipoCents: ipo, targetCents: target, walkSteps: n });

    // Opening tranche: split 20 shares across three desks that can afford them.
    const alloc = [8, 7, 5];
    alloc.forEach((q, i) => {
      const able = cash.map((c, b) => [c, b] as const).filter(([c]) => c >= q * ipo);
      if (able.length === 0) throw new Error('Simulation desks ran out of cash for opening tranches; raise --bots');
      const b = able[Math.floor(pick() * able.length)]![1];
      cash[b]! -= q * ipo;
      shares[b]!.set(a.ticker, (shares[b]!.get(a.ticker) ?? 0) + q);
      ipoSteps.push({ kind: 'IPO', ticker: a.ticker, index: i, seller: null, buyer: b, quantity: q, priceCents: ipo });
    });
  }

  // Spread each ticker's walk across opts.maxSteps rounds.
  const rounds: Step[][] = [ipoSteps, ...Array.from({ length: opts.maxSteps }, () => [] as Step[])];
  const slots: { round: number; ticker: string; j: number }[] = [];
  for (const p of plans) {
    for (let j = 0; j < p.walkSteps; j++) slots.push({ round: 1 + Math.floor((j * opts.maxSteps) / p.walkSteps), ticker: p.ticker, j });
  }
  slots.sort((x, y) => x.round - y.round || hashSeed(opts.seed + x.round, x.ticker) - hashSeed(opts.seed + y.round, y.ticker));
  for (const s of slots) {
    const price = paths.get(s.ticker)![s.j]!;
    const sellers = shares.map((m, b) => [m.get(s.ticker) ?? 0, b] as const).filter(([q]) => q > 0);
    if (sellers.length === 0) continue;
    const seller = sellers[Math.floor(pick() * sellers.length)]![1];
    let qty = 1 + Math.floor(pick() * Math.min(5, shares[seller]!.get(s.ticker)!));
    let buyers = cash.map((c, b) => [c, b] as const).filter(([c, b]) => b !== seller && c >= qty * price);
    if (buyers.length === 0) {
      qty = 1;
      buyers = cash.map((c, b) => [c, b] as const).filter(([c, b]) => b !== seller && c >= price);
      if (buyers.length === 0) continue;
    }
    const buyer = buyers[Math.floor(pick() * buyers.length)]![1];
    cash[buyer]! -= qty * price;
    cash[seller]! += qty * price;
    shares[seller]!.set(s.ticker, shares[seller]!.get(s.ticker)! - qty);
    shares[buyer]!.set(s.ticker, (shares[buyer]!.get(s.ticker) ?? 0) + qty);
    rounds[s.round]!.push({ kind: 'WALK', ticker: s.ticker, index: s.j, seller, buyer, quantity: qty, priceCents: price });
  }
  return { tickers: plans, rounds };
}

/**
 * Tickers the generator may touch: never traded and never priced, or set up
 * by an earlier run of this generator (so a re-run resumes).
 */
export async function eligibleTickers(pool: Pool): Promise<string[]> {
  const r = await pool.query<{ ticker: string }>(
    `SELECT ticker FROM securities
      WHERE (reference_price_source IS NULL AND status IS NULL AND last_price_cents IS NULL)
         OR (reference_price_source = 'ADMIN_SIMULATION' AND verification_source_ref LIKE $1)
      ORDER BY original_rank`,
    [`${SIM_SOURCE_PREFIX}%`],
  );
  return r.rows.map((x) => x.ticker);
}

export interface HistoryResult {
  tickers: number;
  trades: number;
  replayed: number;
  aborted: string[];
}

export async function generateHistory(pool: Pool, adminId: string, opts: HistoryOptions): Promise<HistoryResult> {
  const log = opts.log ?? (() => {});
  const halted = await pool.query(`SELECT 1 FROM trading_halts WHERE scope = 'MARKET' AND ended_at IS NULL`);
  if (halted.rowCount) throw new AppError(409, 'MARKET_HALTED', 'The market is halted; resume it before generating history');

  const tickers = await eligibleTickers(pool);
  const plan = buildHistoryPlan(tickers, opts);
  const epoch = (await pool.query<{ current_epoch: number }>(`SELECT current_epoch FROM market_state WHERE id = 1`)).rows[0]!.current_epoch;
  const bots = await withTx(pool, (c) => ensureSimulationTraders(c, opts.botPrefix, opts.bots, opts.startingCashCents));
  const actor = { adminId, ip: null };
  log(`Plan: ${plan.tickers.length} brothers, ${plan.rounds.flat().length} executions over ${plan.rounds.length} rounds, ${bots.length} desks.`);

  // 1. Reference prices + opening liquidity (skipped where an earlier run did it).
  for (const t of plan.tickers) {
    const s = (
      await pool.query<{ verification_source_ref: string | null }>(`SELECT verification_source_ref FROM securities WHERE ticker = $1`, [t.ticker])
    ).rows[0]!;
    if (!s.verification_source_ref?.startsWith(SIM_SOURCE_PREFIX)) {
      await setSimulatedReference(pool, actor, t.ticker, {
        referencePriceCents: BigInt(t.referenceCents),
        activate: true,
        note: `Active Rankings #${t.activity.activityRank} (${t.activity.emailCount} emails), seed ${opts.seed}`,
      });
    }
    const opened = await pool.query(`SELECT 1 FROM market_maker_configs WHERE ticker = $1 AND opened_epoch = $2`, [t.ticker, epoch]);
    if (opened.rowCount === 0) {
      await upsertMarketMakerConfig(pool, actor, t.ticker, MM_CONFIG(t.ipoBps));
      await openLiquidity(pool, actor, t.ticker);
    }
  }

  // 2. Executions, round by round.
  const aborted = new Set<string>();
  let trades = 0;
  let replayed = 0;
  for (const [r, steps] of plan.rounds.entries()) {
    for (const st of steps) {
      if (aborted.has(st.ticker)) continue;
      const key = (side: string) => `hist:${opts.seed}:${st.ticker}:${st.kind}:${st.index}:${side}`;
      const order = (userId: string, side: 'BUY' | 'SELL') =>
        placeOrder(pool, {
          userId,
          ticker: st.ticker,
          side,
          type: 'LIMIT',
          quantity: BigInt(st.quantity),
          limitPriceCents: BigInt(st.priceCents),
          idempotencyKey: key(side.toLowerCase()),
        });
      const placed = [] as { id: string; userId: string; status: string; replayed: boolean }[];
      if (st.seller !== null) {
        const s = await order(bots[st.seller]!, 'SELL');
        placed.push({ id: s.body.order.id, userId: bots[st.seller]!, status: s.body.order.status, replayed: Boolean(s.body.replayed) });
      }
      const b = await order(bots[st.buyer]!, 'BUY');
      placed.push({ id: b.body.order.id, userId: bots[st.buyer]!, status: b.body.order.status, replayed: Boolean(b.body.replayed) });

      // The sell rests first and is filled by the buy, so read both final statuses from the database.
      const final = await pool.query<{ id: string; status: string }>(`SELECT id, status FROM orders WHERE id = ANY($1::uuid[])`, [
        placed.map((p) => p.id),
      ]);
      for (const p of placed) p.status = final.rows.find((x) => x.id === p.id)!.status;
      if (placed.every((p) => p.status === 'FILLED')) {
        if (placed.every((p) => p.replayed)) replayed++;
        else trades++;
        continue;
      }
      // Something else in the book (e.g. a human order) changed the outcome: tidy up and stop this ticker.
      for (const p of placed) {
        if (p.status === 'OPEN' || p.status === 'PARTIALLY_FILLED') {
          await cancelOrder(pool, { orderId: p.id, actorUserId: p.userId, reason: 'History generator step did not fill as planned' });
        }
      }
      aborted.add(st.ticker);
      log(`  ${st.ticker}: step ${st.kind}#${st.index} did not fill as planned (${placed.map((p) => p.status).join('/')}); stopped this brother.`);
    }
    if (steps.length) log(`Round ${r}/${plan.rounds.length - 1}: ${trades} new executions so far (${replayed} replayed).`);
    if (opts.roundDelayMs > 0 && r < plan.rounds.length - 1 && steps.length) await new Promise((res) => setTimeout(res, opts.roundDelayMs));
  }
  return { tickers: plan.tickers.length, trades, replayed, aborted: [...aborted] };
}
