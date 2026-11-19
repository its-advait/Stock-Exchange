/**
 * Reproducible, idempotent seed:
 *   1. apply migrations
 *   2. the 45 canonical securities (status + reference price UNVERIFIED => non-tradable)
 *   3. historical assignment annotations
 *   4. the system market-maker account (documented starting cash, no shares)
 *   5. optional bootstrap ADMIN from ADMIN_USERNAME / ADMIN_PASSWORD
 *
 * It never invents reference prices or statuses. Import those with `npm run db:import`.
 */
import { passwordSchema, usernameSchema } from '@aez/shared';
import { loadConfig } from '../config.js';
import { runMigrations } from '../db/migrate.js';
import { createPool } from '../db/pool.js';
import { withTx } from '../db/tx.js';
import { createUserInTx, ensureMarketMaker } from '../services/accounts.js';
import { configurePasswordHashing, hashPassword } from '../services/passwords.js';
import { seedUniverse } from '../services/securitiesAdmin.js';

const cfg = loadConfig();
configurePasswordHashing({ memoryCost: cfg.ARGON2_MEMORY_KIB, timeCost: cfg.ARGON2_TIME_COST });
const pool = createPool(cfg.DATABASE_URL, 2);
try {
  await runMigrations(pool);
  const adminHash =
    cfg.ADMIN_USERNAME && cfg.ADMIN_PASSWORD
      ? (usernameSchema.parse(cfg.ADMIN_USERNAME), passwordSchema.parse(cfg.ADMIN_PASSWORD), await hashPassword(cfg.ADMIN_PASSWORD))
      : null;
  await withTx(pool, async (c) => {
    const { inserted } = await seedUniverse(c);
    console.log(`Securities: ${inserted} inserted (45 canonical total).`);
    const mm = await ensureMarketMaker(c, cfg.MARKET_MAKER_USERNAME, cfg.MARKET_MAKER_STARTING_CASH_CENTS);
    console.log(`Market maker account: ${mm}`);
    if (adminHash && cfg.ADMIN_USERNAME) {
      const exists = await c.query(`SELECT 1 FROM users WHERE lower(username) = lower($1)`, [cfg.ADMIN_USERNAME]);
      if (exists.rowCount === 0) {
        await createUserInTx(c, { username: cfg.ADMIN_USERNAME, passwordHash: adminHash, role: 'ADMIN', startingCashCents: cfg.STARTING_CASH_CENTS });
        console.log(`Admin "${cfg.ADMIN_USERNAME}" created.`);
      } else {
        console.log(`Admin "${cfg.ADMIN_USERNAME}" already exists (unchanged).`);
      }
    }
  });
  console.log('Seed complete. All securities remain NON-TRADABLE until verified data is imported.');
} finally {
  await pool.end();
}
