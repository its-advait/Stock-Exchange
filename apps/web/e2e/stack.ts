/**
 * End-to-end stack: a throwaway embedded PostgreSQL, the real migrations + seed,
 * and the real API server serving the PRODUCTION web build from the same origin
 * (exactly how it is deployed). Started by Playwright's webServer; stopped on SIGTERM.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PG_PORT = Number(process.env.E2E_PG_PORT ?? 54329);
const APP_PORT = Number(process.env.E2E_PORT ?? 4100);
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
if (!adminPassword) throw new Error('E2E_ADMIN_PASSWORD must be provided by playwright.config.ts');
if (!fs.existsSync(path.join(root, 'apps/web/dist/index.html'))) throw new Error('Build the web app first (npm run build -w @aez/web)');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aez-e2e-pg-'));
const db = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'e2e', port: PG_PORT, persistent: false, onLog: () => {} });
await db.initialise();
await db.start();
const c = new pg.Client({ connectionString: `postgres://postgres:e2e@localhost:${PG_PORT}/postgres` });
await c.connect();
await c.query('CREATE DATABASE aez_e2e');
await c.end();

const env = {
  ...process.env,
  NODE_ENV: 'development', // plain-http cookies on localhost; everything else matches production
  DATABASE_URL: `postgres://postgres:e2e@localhost:${PG_PORT}/aez_e2e`,
  PORT: String(APP_PORT),
  WEB_ORIGINS: `http://localhost:${APP_PORT}`,
  WEB_DIST_DIR: path.join(root, 'apps/web/dist'),
  ADMIN_USERNAME: 'e2e_admin',
  ADMIN_PASSWORD: adminPassword,
  ARGON2_MEMORY_KIB: '4096',
  ARGON2_TIME_COST: '1',
  OUTBOX_POLL_MS: '200',
  LOG_LEVEL: 'warn',
};
const tsx = path.join(root, 'node_modules/.bin/tsx');
const seed = spawnSync(tsx, ['--conditions=source', 'apps/server/src/scripts/seed.ts'], { cwd: root, env, stdio: 'inherit' });
if (seed.status !== 0) throw new Error('seed failed');

const server: ChildProcess = spawn(tsx, ['--conditions=source', 'apps/server/src/index.ts'], { cwd: root, env, stdio: 'inherit' });

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  await db.stop().catch(() => {});
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.on('exit', (code) => {
  if (!stopping) {
    console.error(`API server exited unexpectedly (${code})`);
    void stop();
  }
});
