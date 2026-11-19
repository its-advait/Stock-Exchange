import { expect, inject } from 'vitest';
import type pg from 'pg';
import { loadConfig, type AppConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import { withTx } from '../src/db/tx.js';
import { placeOrder, type PlaceOrderInput } from '../src/engine/matching.js';
import { createUser, ensureMarketMaker } from '../src/services/accounts.js';
import { checkIntegrity } from '../src/services/integrity.js';
import { issueShares } from '../src/services/marketMaker.js';
import { configurePasswordHashing } from '../src/services/passwords.js';
import { seedUniverse } from '../src/services/securitiesAdmin.js';

export const STARTING_CASH = 1_000_000n; // $10,000.00
export const MM_CASH = 25_000_000n;

configurePasswordHashing({ memoryCost: 1024, timeCost: 1 });

export function databaseUrl(): string {
  return inject('databaseUrl');
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return loadConfig(
    {
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl(),
      LOG_LEVEL: 'silent',
      WEB_ORIGINS: 'http://localhost:5173',
      RATE_LIMIT_ENABLED: 'false',
      ARGON2_MEMORY_KIB: '1024',
      ARGON2_TIME_COST: '1',
      OUTBOX_POLL_MS: '50',
    },
    overrides,
  );
}

export function newPool(max = 30): pg.Pool {
  return createPool(databaseUrl(), max);
}

/** Drop everything and rebuild schema + canonical seed. Deterministic (sequences restart). */
export async function resetDatabase(pool: pg.Pool): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;`);
  await runMigrations(pool);
  await withTx(pool, async (c) => {
    await seedUniverse(c);
    await ensureMarketMaker(c, 'aez_market_maker', MM_CASH);
  });
}

let userCounter = 0;
export async function makeUser(pool: pg.Pool, name?: string, role: 'USER' | 'ADMIN' = 'USER'): Promise<string> {
  userCounter++;
  const u = await createUser(pool, {
    username: name ?? `trader_${userCounter}`,
    password: 'correct horse battery',
    role,
    startingCashCents: STARTING_CASH,
  });
  return u.id;
}

/** Mark a security tradable with a fixture reference price (test only). */
export async function activate(pool: pg.Pool, ticker: string, referencePriceCents: bigint): Promise<void> {
  await pool.query(
    `UPDATE securities SET status = 'ACTIVE', status_source = 'VERIFIED_IMPORT', status_updated_at = now(),
            reference_price_cents = $2, reference_price_source = 'VERIFIED_IMPORT', reference_verified_at = now(),
            reference_verified_by = 'test-fixture', verification_source_ref = 'TEST FIXTURE ONLY'
      WHERE ticker = $1`,
    [ticker, referencePriceCents],
  );
}

/** Issue shares to a user through the real issuance path (immutable ledger + position ledger). */
export async function grantShares(pool: pg.Pool, ticker: string, userId: string, quantity: bigint): Promise<void> {
  await withTx(pool, async (c) => {
    const ms = await c.query<{ current_epoch: number }>(`SELECT current_epoch FROM market_state WHERE id = 1 FOR SHARE`);
    await c.query(`SELECT 1 FROM securities WHERE ticker = $1 FOR UPDATE`, [ticker]);
    await issueShares(c, { ticker, recipientUserId: userId, quantity, reason: 'test fixture', approvedBy: null, epoch: ms.rows[0]!.current_epoch });
  });
}

let keyCounter = 0;
export const nextKey = () => `test-key-${++keyCounter}-${Date.now()}`;

export function limit(userId: string, ticker: string, side: 'BUY' | 'SELL', quantity: bigint, price: bigint, key = nextKey()) {
  return { userId, ticker, side, type: 'LIMIT' as const, quantity, limitPriceCents: price, idempotencyKey: key } satisfies PlaceOrderInput;
}

export function market(userId: string, ticker: string, side: 'BUY' | 'SELL', quantity: bigint, maxSpendCents?: bigint, key = nextKey()) {
  return {
    userId,
    ticker,
    side,
    type: 'MARKET' as const,
    quantity,
    maxSpendCents: side === 'BUY' ? (maxSpendCents ?? null) : null,
    idempotencyKey: key,
  } satisfies PlaceOrderInput;
}

export async function place(pool: pg.Pool, input: PlaceOrderInput) {
  return (await placeOrder(pool, input)).body;
}

export async function cashOf(pool: pg.Pool, userId: string) {
  const r = await pool.query<{ cash_cents: bigint; reserved_cents: bigint }>(`SELECT cash_cents, reserved_cents FROM cash_accounts WHERE user_id = $1`, [
    userId,
  ]);
  return { cash: r.rows[0]!.cash_cents, reserved: r.rows[0]!.reserved_cents };
}

export async function holdingOf(pool: pg.Pool, userId: string, ticker: string) {
  const r = await pool.query<{ quantity: bigint; reserved_quantity: bigint }>(
    `SELECT quantity, reserved_quantity FROM holdings WHERE user_id = $1 AND ticker = $2`,
    [userId, ticker],
  );
  return { qty: r.rows[0]?.quantity ?? 0n, reserved: r.rows[0]?.reserved_quantity ?? 0n };
}

export async function tradesOf(pool: pg.Pool, ticker: string) {
  const r = await pool.query<{ price_cents: bigint; quantity: bigint; buyer_id: string; seller_id: string; maker_order_id: string; taker_order_id: string }>(
    `SELECT price_cents, quantity, buyer_id, seller_id, maker_order_id, taker_order_id FROM trades WHERE ticker = $1 ORDER BY id`,
    [ticker],
  );
  return r.rows;
}

export async function expectIntegrity(pool: pg.Pool): Promise<void> {
  const r = await checkIntegrity(pool);
  expect(r.violations).toEqual([]);
}
