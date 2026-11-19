import type pg from 'pg';
import { RETRYABLE_PG_CODES, pgCode } from '../lib/errors.js';

export interface TxOptions {
  /** Max attempts for serialization failures / deadlocks (should be rare given our lock order). */
  maxAttempts?: number;
}

/**
 * Run `fn` inside a single READ COMMITTED transaction on a dedicated client.
 * Any thrown error rolls back the whole transaction. Deadlocks and
 * serialization failures are retried with jittered backoff; everything inside
 * `fn` must therefore be safe to re-run (it is: all effects are in the tx).
 */
export async function withTx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>, opts: TxOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5;
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true;
      }
      const code = pgCode(err);
      if (code && RETRYABLE_PG_CODES.has(code) && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 5 * attempt + Math.floor(Math.random() * 20)));
        continue;
      }
      throw err;
    } finally {
      client.release(broken);
    }
  }
}
