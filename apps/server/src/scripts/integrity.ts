import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { checkIntegrity } from '../services/integrity.js';

const pool = createPool(loadConfig().DATABASE_URL, 2);
try {
  const r = await checkIntegrity(pool);
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
} finally {
  await pool.end();
}
