# Simulated opening history (Active Rankings)

The original starting prices and listing statuses were never supplied. To give every brother a price, a chart and some trading history for the demo, the exchange can generate a **simulated** opening history from the pledge class's *Active Rankings* document. It is labeled SIMULATED wherever it appears, and nothing bypasses the exchange.

## What the document provides

`packages/shared/src/activity.ts` holds all 45 entries, transcribed from the document: the activity rank, the count in brackets (ListServ emails) and the write-up. Each brother's page shows them in an **Active Rankings** panel, labeled as reference content rather than market data.

## How prices are chosen

```
score = 0.6 × (46 − rank) / 45  +  0.4 × ln(1 + emails) / ln(1 + 587)      (0 … 1)
reference price = $8.00 + score × $52.00, rounded to 5¢                        ($8.70 … $60.00)
```

The ranking position dominates the score; the email count is log-scaled so that 587 vs 342 matters less than 10 vs 0.

## How the history is made

`node apps/server/dist/scripts/generate-history.js --apply` does this for every eligible brother:

1. **Sets a SIMULATED reference price** with `setSimulatedReference` (audited, attributed to an admin). It never overrides a verified price or status.
2. **Opens market-maker liquidity:** it issues 140 shares into the immutable issuance ledger, then places a 20-share opening tranche at the open price, asks at +10% (40) and +20% (80), and bids at −10% (20) and −20% (20).
3. **Simulation desks trade through the real matching engine.** Six `aez_sim_desk_N` accounts (account type `SIMULATION`) buy the opening tranche and then trade with each other. Each step is a limit sell followed by a matching limit buy at the planned price.
   * The price path runs from the open price toward a target, with noise, and stays within ±8% of the reference (inside the market maker's quotes).
   * Active brothers open about 6% below their reference and trend up to about +5%. Quiet brothers open above it and drift down.
   * More activity means more trades: from 11 executions for the quietest brother to 33 for #1.

The simulation desks:

* can't log in (no password; the database constraint enforces this);
* are never ranked, since every leaderboard, trader profile and stat requires `account_type = 'HUMAN'`;
* are funded with the same $10,000 `INITIAL_GRANT` as any new account, so the cash ledger stays conserved and the integrity check stays clean.

Every chart point, last price and volume figure is therefore a genuine execution with full cash and share accounting. Trades are timestamped when they happen. `--round-delay-ms` spreads them over time; for example, `60000` spreads them over about 30 minutes. Nothing is backdated.

## Running it

```bash
# preview the plan (no writes)
node apps/server/dist/scripts/generate-history.js
# execute, spreading trades over ~30 minutes
node apps/server/dist/scripts/generate-history.js --apply --round-delay-ms 60000
```

* **Deterministic and resumable.** The plan depends only on the seed (`--seed`, default 2026) and the set of eligible brothers. Every order uses a deterministic idempotency key, so re-running with the same seed replays the finished steps and continues. Nothing executes twice.
* **Eligible brothers** are those never priced and never traded, or those set up by an earlier run of the generator.
* **If a human order changes a step's outcome** mid-run, the generator cancels its leftover order and stops that brother; the rest continue.
* It finishes by running the ledger integrity check.

## Undoing it

Executions are append-only. The only way to remove this history is the protected **simulation reset**, which wipes all trading for everyone.
