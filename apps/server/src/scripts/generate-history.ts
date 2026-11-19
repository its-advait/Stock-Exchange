/**
 * Generate the simulated opening history from the Active Rankings document.
 *
 *   node dist/scripts/generate-history.js                 # dry run: print the plan
 *   node dist/scripts/generate-history.js --apply         # execute through the matching engine
 *     [--seed 2026] [--round-delay-ms 60000] [--admin <username>]
 *
 * Re-running with the same seed resumes: finished steps replay via their
 * idempotency keys and nothing is executed twice. See docs/SIMULATED_HISTORY.md.
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { buildHistoryPlan, DEFAULT_HISTORY_OPTIONS, eligibleTickers, generateHistory } from '../services/historyGenerator.js';
import { checkIntegrity } from '../services/integrity.js';

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    seed: { type: 'string', default: String(DEFAULT_HISTORY_OPTIONS.seed) },
    'round-delay-ms': { type: 'string', default: '0' },
    admin: { type: 'string' },
  },
});

const cfg = loadConfig();
const pool = createPool(cfg.DATABASE_URL, 4);
const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
let exitCode = 0;
try {
  const opts = {
    ...DEFAULT_HISTORY_OPTIONS,
    seed: Number(values.seed),
    roundDelayMs: Number(values['round-delay-ms']),
    startingCashCents: cfg.STARTING_CASH_CENTS,
    log: (m: string) => console.log(m),
  };
  const tickers = await eligibleTickers(pool);
  const plan = buildHistoryPlan(tickers, opts);
  console.log(`Eligible brothers: ${tickers.length} of 45.`);
  for (const t of plan.tickers) {
    console.log(
      `  #${String(t.activity.activityRank).padStart(2)} ${t.ticker.padEnd(6)} emails ${String(t.activity.emailCount).padStart(3)}` +
        `  ref ${dollars(t.referenceCents).padStart(7)}  open ${dollars(t.ipoCents).padStart(7)}  target ${dollars(t.targetCents).padStart(7)}  walk ${t.walkSteps}`,
    );
  }
  console.log(`Executions planned: ${plan.rounds.flat().length}.`);
  if (!values.apply) {
    console.log('Dry run only. Add --apply to execute.');
  } else {
    const admin = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND account_type = 'HUMAN'
         AND ($1::text IS NULL OR lower(username) = lower($1)) ORDER BY created_at LIMIT 1`,
      [values.admin ?? null],
    );
    if (!admin.rows[0]) throw new Error('No active admin found to attribute the audit entries to (use --admin <username>)');

    const res = await generateHistory(pool, admin.rows[0].id, opts);
    console.log(`Done: ${res.tickers} brothers, ${res.trades} new executions, ${res.replayed} replayed.`);
    if (res.aborted.length) console.log(`Stopped early (book changed underneath): ${res.aborted.join(', ')}`);
    const integrity = await checkIntegrity(pool);
    console.log(`Integrity: ${integrity.ok ? 'ok' : 'VIOLATIONS'}`);
    if (!integrity.ok) {
      console.log(integrity.violations.join('\n'));
      exitCode = 1;
    }
  }
} finally {
  await pool.end();
}
process.exit(exitCode);
