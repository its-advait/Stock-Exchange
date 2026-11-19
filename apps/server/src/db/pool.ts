import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

// int8 (BIGINT) -> JS bigint. Money and quantities are never parsed as floats.
pg.types.setTypeParser(20, (v) => BigInt(v));
// numeric stays a string; all money aggregates are cast to ::bigint in SQL.

export type Pool = pg.Pool;
export type Client = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;
export type Db = NodePgDatabase<typeof schema>;

export function createPool(connectionString: string, max = 20): pg.Pool {
  const pool = new pg.Pool({ connectionString, max, application_name: 'aez-exchange' });
  pool.on('error', (err) => {
    // Idle client errors (e.g. server restart). The pool discards the client.
    console.error('[pg] idle client error', err.message);
  });
  return pool;
}

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema });
}

export { schema };
