/**
 * DEVELOPMENT ONLY: apply a clearly-labeled ADMIN_SIMULATION reference price to every
 * security that has no verified price, so the exchange can be exercised before the
 * original dataset arrives. The price is supplied by YOU; nothing is invented.
 *
 *   npm run db:simulate -- --price-cents 1000 --confirm-simulated [--admin <username>]
 *
 * Refuses to run when NODE_ENV=production. Verified prices/statuses are never touched.
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { setSimulatedReference } from '../services/securitiesAdmin.js';

const { values } = parseArgs({
  options: {
    'price-cents': { type: 'string' },
    'confirm-simulated': { type: 'boolean', default: false },
    admin: { type: 'string' },
  },
});
const cfg = loadConfig();
if (cfg.NODE_ENV === 'production') {
  console.error('Refusing to apply simulated prices in production. Use the admin API with explicit acknowledgement.');
  process.exit(1);
}
const price = values['price-cents'] ? BigInt(values['price-cents']) : 0n;
if (price <= 0n || !values['confirm-simulated']) {
  console.error('Usage: --price-cents <positive integer> --confirm-simulated [--admin <username>]');
  process.exit(2);
}
const pool = createPool(cfg.DATABASE_URL, 2);
try {
  const adminName = values.admin ?? cfg.ADMIN_USERNAME;
  const admin = await pool.query<{ id: string }>(`SELECT id FROM users WHERE lower(username) = lower($1) AND role = 'ADMIN'`, [adminName ?? '']);
  if (!admin.rows[0]) throw new Error('An ADMIN account is required (seed one with ADMIN_USERNAME/ADMIN_PASSWORD).');
  const secs = await pool.query<{ ticker: string; status: string | null }>(
    `SELECT ticker, status FROM securities WHERE reference_price_source IS DISTINCT FROM 'VERIFIED_IMPORT' ORDER BY original_rank`,
  );
  for (const s of secs.rows) {
    await setSimulatedReference(pool, { adminId: admin.rows[0].id }, s.ticker, {
      referencePriceCents: price,
      activate: s.status === null || s.status === 'ACTIVE',
      note: 'Local development simulation (simulate-dev script)',
    }).catch((e: Error) => console.warn(`  ${s.ticker}: ${e.message}`));
  }
  console.log(`Applied SIMULATED reference ${price} cents to ${secs.rows.length} securities. These are labeled SIMULATED in the API.`);
} finally {
  await pool.end();
}
