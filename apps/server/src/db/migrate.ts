import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Works from both src/db (tsx) and dist/db (compiled). */
export const MIGRATIONS_FOLDER = path.resolve(here, '../../drizzle');

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await migrate(createDb(pool), { migrationsFolder: MIGRATIONS_FOLDER });
}
