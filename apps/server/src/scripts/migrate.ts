import { loadConfig } from '../config.js';
import { runMigrations } from '../db/migrate.js';
import { createPool } from '../db/pool.js';

const cfg = loadConfig();
const pool = createPool(cfg.DATABASE_URL, 2);
try {
  await runMigrations(pool);
  console.log('Migrations applied.');
} finally {
  await pool.end();
}
