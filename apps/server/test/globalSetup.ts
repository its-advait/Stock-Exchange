/**
 * Starts a throwaway PostgreSQL (embedded-postgres) for the test run, unless
 * TEST_DATABASE_URL points at an existing server/database to use instead.
 * WARNING: tests DROP and recreate the `public` schema of that database.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let server: EmbeddedPostgres | null = null;
let dir: string | null = null;

export async function setup(project: TestProject) {
  if (process.env.TEST_DATABASE_URL) {
    project.provide('databaseUrl', process.env.TEST_DATABASE_URL);
    return;
  }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aez-test-pg-'));
  const port = 55000 + Math.floor(Math.random() * 2000);
  server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'test', port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  const c = new pg.Client({ connectionString: `postgres://postgres:test@localhost:${port}/postgres` });
  await c.connect();
  await c.query('CREATE DATABASE aez_test');
  await c.end();
  project.provide('databaseUrl', `postgres://postgres:test@localhost:${port}/aez_test`);
}

export async function teardown() {
  await server?.stop();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}
