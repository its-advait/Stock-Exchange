import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(200).default(20),
  /** Comma separated list of browser origins allowed to call the API with credentials. */
  WEB_ORIGINS: z
    .string()
    .optional()
    .transform((s) =>
      (s ?? '')
        .split(',')
        .map((x) => x.trim().replace(/\/$/, ''))
        .filter(Boolean),
    ),
  TRUST_PROXY: bool(false),
  COOKIE_SECURE: z.enum(['true', 'false', '1', '0']).optional(),
  SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default('aez_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 30),
  SESSION_IDLE_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 7),
  RATE_LIMIT_ENABLED: bool(true),
  /** Exactly $10,000.00 per the competition rules. */
  STARTING_CASH_CENTS: z.coerce.bigint().default(1_000_000n),
  /** Documented market-maker starting cash: $250,000.00 */
  MARKET_MAKER_STARTING_CASH_CENTS: z.coerce.bigint().default(25_000_000n),
  MARKET_MAKER_USERNAME: z.string().default('aez_market_maker'),
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(1024).default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().min(1).default(2),
  /** Enable the Socket.IO Postgres adapter so events fan out across multiple backend instances. */
  SOCKET_IO_PG_ADAPTER: bool(false),
  OUTBOX_POLL_MS: z.coerce.number().int().min(50).default(1000),
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  /**
   * Directory holding the built web app (apps/web/dist). When set (or auto-detected in
   * production), the API also serves the SPA from the same origin.
   */
  WEB_DIST_DIR: z.string().optional(),
  /** Set automatically by Railway; used as the default allowed origin when WEB_ORIGINS is unset. */
  RAILWAY_PUBLIC_DOMAIN: z.string().optional(),
});

export type AppConfig = Omit<z.infer<typeof envSchema>, 'COOKIE_SECURE'> & { COOKIE_SECURE: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<AppConfig> = {}): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  const { COOKIE_SECURE, ...rest } = parsed.data;
  const cookieSecure =
    COOKIE_SECURE === undefined ? rest.NODE_ENV === 'production' : COOKIE_SECURE === 'true' || COOKIE_SECURE === '1';
  if (rest.WEB_ORIGINS.length === 0) {
    if (rest.RAILWAY_PUBLIC_DOMAIN) rest.WEB_ORIGINS = [`https://${rest.RAILWAY_PUBLIC_DOMAIN}`];
    else if (rest.NODE_ENV !== 'production') rest.WEB_ORIGINS = ['http://localhost:5173'];
    // Production with no origin: allowed for CLI scripts (migrate/seed); the server refuses to start (assertServable).
  }
  const cfg: AppConfig = { ...rest, COOKIE_SECURE: cookieSecure, ...overrides };
  if (cfg.NODE_ENV === 'production' && !cfg.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must not be disabled in production');
  }
  if (cfg.NODE_ENV === 'production' && cfg.WEB_ORIGINS.some((o) => !/^https:\/\//.test(o) && !/^http:\/\/localhost(:\d+)?$/.test(o))) {
    throw new Error('WEB_ORIGINS must be https:// origins in production');
  }
  if (cfg.STARTING_CASH_CENTS !== 1_000_000n && cfg.NODE_ENV === 'production') {
    throw new Error('STARTING_CASH_CENTS must be exactly 1000000 ($10,000.00) in production');
  }
  return cfg;
}

/** Checks that only matter for a process that serves HTTP (not for migrate/seed scripts). */
export function assertServable(cfg: AppConfig): void {
  if (cfg.WEB_ORIGINS.length === 0) {
    throw new Error('WEB_ORIGINS must be set in production (the public https:// origin of the site, e.g. https://aez.up.railway.app)');
  }
}
