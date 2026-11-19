/**
 * Start a local, persistent PostgreSQL server for development without Docker or
 * a system install (uses the `embedded-postgres` binaries from npm).
 * Data lives in <repo>/.local/pgdata. Stop with Ctrl+C.
 *
 * Default DATABASE_URL: postgres://postgres:aez_local_dev@localhost:5433/aez
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const dataDir = path.join(root, '.local', 'pgdata');
const port = Number(process.env.LOCAL_PG_PORT ?? 5433);
const password = process.env.LOCAL_PG_PASSWORD ?? 'aez_local_dev';

const fresh = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));
const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password, port, persistent: true });
if (fresh) {
  fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  await server.initialise();
}
await server.start();
const c = new pg.Client({ connectionString: `postgres://postgres:${password}@localhost:${port}/postgres` });
await c.connect();
const exists = await c.query(`SELECT 1 FROM pg_database WHERE datname = 'aez'`);
if (exists.rowCount === 0) await c.query(`CREATE DATABASE aez`);
await c.end();
console.log(`PostgreSQL running. DATABASE_URL=postgres://postgres:${password}@localhost:${port}/aez`);
console.log('Press Ctrl+C to stop.');

const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
setInterval(() => undefined, 1 << 30);
