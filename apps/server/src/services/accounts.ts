import type { Client, Pool, Queryable } from '../db/pool.js';
import { withTx } from '../db/tx.js';
import { conflict, pgCode } from '../lib/errors.js';
import { hashPassword } from './passwords.js';

export interface UserRow {
  id: string;
  username: string;
  role: 'USER' | 'ADMIN';
  account_type: 'HUMAN' | 'MARKET_MAKER' | 'SIMULATION';
  status: 'ACTIVE' | 'DISABLED';
  created_at: Date;
}

export const USER_COLUMNS = 'id, username, role, account_type, status, created_at';

export interface CreateUserInput {
  username: string;
  password: string;
  role?: 'USER' | 'ADMIN';
  startingCashCents: bigint;
}

/**
 * Create a human account with exactly `startingCashCents` (always $10,000 in
 * production) recorded as an INITIAL_GRANT ledger entry. Atomic.
 */
export async function createUser(pool: Pool, input: CreateUserInput): Promise<UserRow> {
  const passwordHash = await hashPassword(input.password);
  return withTx(pool, (c) => createUserInTx(c, { ...input, passwordHash }));
}

export async function createUserInTx(
  c: Client,
  input: Omit<CreateUserInput, 'password'> & { passwordHash: string },
): Promise<UserRow> {
  const ms = await c.query<{ current_epoch: number }>(`SELECT current_epoch FROM market_state WHERE id = 1 FOR SHARE`);
  let user: UserRow;
  try {
    user = (
      await c.query<UserRow>(
        `INSERT INTO users (username, password_hash, role, account_type) VALUES ($1, $2, $3, 'HUMAN') RETURNING ${USER_COLUMNS}`,
        [input.username, input.passwordHash, input.role ?? 'USER'],
      )
    ).rows[0]!;
  } catch (e) {
    if (pgCode(e) === '23505') throw conflict('USERNAME_TAKEN', 'That username is already taken');
    throw e;
  }
  await c.query(`INSERT INTO cash_accounts (user_id, cash_cents) VALUES ($1, $2)`, [user.id, input.startingCashCents]);
  await c.query(
    `INSERT INTO cash_ledger (user_id, amount_cents, balance_after_cents, reason, epoch) VALUES ($1, $2, $2, 'INITIAL_GRANT', $3)`,
    [user.id, input.startingCashCents, ms.rows[0]!.current_epoch],
  );
  return user;
}

/** Create (once) the designated system market-maker account. It cannot log in. */
export async function ensureMarketMaker(c: Queryable, username: string, startingCashCents: bigint): Promise<string> {
  const existing = await c.query<{ id: string }>(`SELECT id FROM users WHERE account_type = 'MARKET_MAKER'`);
  if (existing.rows[0]) return existing.rows[0].id;
  const ms = await c.query<{ current_epoch: number }>(`SELECT current_epoch FROM market_state WHERE id = 1`);
  const id = (
    await c.query<{ id: string }>(
      `INSERT INTO users (username, password_hash, role, account_type) VALUES ($1, NULL, 'USER', 'MARKET_MAKER') RETURNING id`,
      [username],
    )
  ).rows[0]!.id;
  await c.query(`INSERT INTO cash_accounts (user_id, cash_cents) VALUES ($1, $2)`, [id, startingCashCents]);
  if (startingCashCents > 0n) {
    await c.query(
      `INSERT INTO cash_ledger (user_id, amount_cents, balance_after_cents, reason, epoch)
       VALUES ($1, $2, $2, 'MARKET_MAKER_FUNDING', $3)`,
      [id, startingCashCents, ms.rows[0]!.current_epoch],
    );
  }
  return id;
}

/**
 * Create (once) `count` simulation-desk traders named `${prefix}_1..N`. They
 * cannot log in, are never ranked, and are funded exactly like a new human
 * (an INITIAL_GRANT of `startingCashCents`), so the ledger stays conserved.
 * Returns their ids in name order.
 */
export async function ensureSimulationTraders(c: Client, prefix: string, count: number, startingCashCents: bigint): Promise<string[]> {
  const ms = await c.query<{ current_epoch: number }>(`SELECT current_epoch FROM market_state WHERE id = 1 FOR SHARE`);
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    const username = `${prefix}_${i}`;
    const ex = await c.query<{ id: string; account_type: string }>(`SELECT id, account_type FROM users WHERE lower(username) = lower($1)`, [username]);
    if (ex.rows[0]) {
      if (ex.rows[0].account_type !== 'SIMULATION') throw conflict('USERNAME_TAKEN', `Username ${username} belongs to a non-simulation account`);
      ids.push(ex.rows[0].id);
      continue;
    }
    const id = (
      await c.query<{ id: string }>(
        `INSERT INTO users (username, password_hash, role, account_type) VALUES ($1, NULL, 'USER', 'SIMULATION') RETURNING id`,
        [username],
      )
    ).rows[0]!.id;
    await c.query(`INSERT INTO cash_accounts (user_id, cash_cents) VALUES ($1, $2)`, [id, startingCashCents]);
    await c.query(
      `INSERT INTO cash_ledger (user_id, amount_cents, balance_after_cents, reason, epoch) VALUES ($1, $2, $2, 'INITIAL_GRANT', $3)`,
      [id, startingCashCents, ms.rows[0]!.current_epoch],
    );
    ids.push(id);
  }
  return ids;
}

export async function getMarketMakerId(q: Queryable): Promise<string | null> {
  const r = await q.query<{ id: string }>(`SELECT id FROM users WHERE account_type = 'MARKET_MAKER'`);
  return r.rows[0]?.id ?? null;
}
