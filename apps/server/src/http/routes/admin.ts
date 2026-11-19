import {
  adminCreateUserSchema,
  adminUpdateUserSchema,
  haltRequestSchema,
  listingStatusChangeSchema,
  marketMakerConfigSchema,
  newsPostSchema,
  newsVisibilitySchema,
  paginationSchema,
  simulatedReferenceSchema,
  simulationResetSchema,
} from '@aez/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { cancelOrder } from '../../engine/matching.js';
import { audit } from '../../lib/audit.js';
import { iso, num } from '../../lib/json.js';
import { createUser } from '../../services/accounts.js';
import { createNews, listNews, setNewsHidden } from '../../services/content.js';
import { haltMarket, haltSymbol, resumeMarket, resumeSymbol } from '../../services/halts.js';
import { checkIntegrity } from '../../services/integrity.js';
import { openLiquidity, upsertMarketMakerConfig } from '../../services/marketMaker.js';
import { cashLedgerFor, positionLedgerFor } from '../../services/portfolio.js';
import { resetSimulation } from '../../services/reset.js';
import { setListingStatus, setSimulatedReference } from '../../services/securitiesAdmin.js';
import { listUsers, updateUser, userView } from '../../services/usersAdmin.js';
import { parse, requireAdmin, tickerParam, uuidParam, type AppContext } from '../context.js';

export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const { pool, cfg } = ctx;
  // Every admin route requires an authenticated ADMIN.
  app.addHook('preHandler', async (req) => {
    requireAdmin(req);
  });
  const actor = (req: FastifyRequest) => ({ adminId: req.user!.id, ip: req.ip });
  const done = () => {
    ctx.kickOutbox();
    return { ok: true };
  };
  const userQuery = paginationSchema.extend({ userId: z.uuid().optional() });

  /* ------------------------------- Users ------------------------------- */
  app.get('/users', async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) }), req.query);
    return { users: await listUsers(pool, q.limit, q.offset) };
  });
  app.post('/users', async (req, reply) => {
    const body = parse(adminCreateUserSchema, req.body);
    const user = await createUser(pool, { ...body, startingCashCents: cfg.STARTING_CASH_CENTS });
    await audit(pool, { actorUserId: req.user!.id, action: 'USER_CREATE', targetType: 'user', targetId: user.id, details: { username: user.username, role: user.role }, ip: req.ip });
    return reply.code(201).send({ user: userView(user) });
  });
  app.patch('/users/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const body = parse(adminUpdateUserSchema, req.body);
    const user = await updateUser(pool, actor(req), id, body);
    ctx.kickOutbox();
    return { user };
  });

  /* --------------------------- Fictional news -------------------------- */
  app.get('/news', async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
    return { posts: await listNews(pool, { limit: q.limit, includeHidden: true }) };
  });
  app.post('/news', async (req, reply) => {
    const body = parse(newsPostSchema, req.body);
    const post = await createNews(pool, actor(req), body);
    ctx.kickOutbox();
    return reply.code(201).send({ post });
  });
  app.patch('/news/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { hidden } = parse(newsVisibilitySchema, req.body);
    return { post: await setNewsHidden(pool, actor(req), id, hidden) };
  });

  /* ------------------------------- Halts ------------------------------- */
  app.post('/market/halt', async (req) => {
    const { reason } = parse(haltRequestSchema, req.body);
    await haltMarket(pool, actor(req), reason);
    return done();
  });
  app.post('/market/resume', async (req) => {
    const { reason } = parse(haltRequestSchema, req.body);
    await resumeMarket(pool, actor(req), reason);
    return done();
  });
  app.post('/securities/:ticker/halt', async (req) => {
    const { ticker } = parse(tickerParam, req.params);
    const { reason } = parse(haltRequestSchema, req.body);
    await haltSymbol(pool, actor(req), ticker, reason);
    return done();
  });
  app.post('/securities/:ticker/resume', async (req) => {
    const { ticker } = parse(tickerParam, req.params);
    const { reason } = parse(haltRequestSchema, req.body);
    await resumeSymbol(pool, actor(req), ticker, reason);
    return done();
  });

  /* ----------------------- Listing / reference data ---------------------- */
  app.post('/securities/:ticker/listing-status', async (req) => {
    const { ticker } = parse(tickerParam, req.params);
    const body = parse(listingStatusChangeSchema, req.body);
    await setListingStatus(pool, actor(req), ticker, body);
    return done();
  });
  app.post('/securities/:ticker/simulated-reference', async (req) => {
    const { ticker } = parse(tickerParam, req.params);
    const body = parse(simulatedReferenceSchema, req.body);
    await setSimulatedReference(pool, actor(req), ticker, {
      referencePriceCents: BigInt(body.referencePriceCents),
      activate: body.activate,
      note: body.note,
    });
    return done();
  });

  /* ---------------------------- Market maker ---------------------------- */
  app.get('/market-maker', async () => {
    const mm = await pool.query<{ id: string; username: string; cash_cents: bigint; reserved_cents: bigint }>(
      `SELECT u.id, u.username, c.cash_cents, c.reserved_cents FROM users u JOIN cash_accounts c ON c.user_id = u.id
        WHERE u.account_type = 'MARKET_MAKER'`,
    );
    const configs = await pool.query(`SELECT * FROM market_maker_configs ORDER BY ticker`);
    const inventory = await pool.query<{ ticker: string; quantity: bigint; reserved_quantity: bigint }>(
      `SELECT h.ticker, h.quantity, h.reserved_quantity FROM holdings h JOIN users u ON u.id = h.user_id
        WHERE u.account_type = 'MARKET_MAKER' AND h.quantity > 0 ORDER BY h.ticker`,
    );
    const m = mm.rows[0];
    return {
      account: m ? { id: m.id, username: m.username, cashCents: num(m.cash_cents), reservedCashCents: num(m.reserved_cents) } : null,
      inventory: inventory.rows.map((i) => ({ ticker: i.ticker, quantity: num(i.quantity), reservedQuantity: num(i.reserved_quantity) })),
      configs: configs.rows,
    };
  });
  app.put('/market-maker/:ticker', async (req) => {
    const { ticker } = parse(tickerParam, req.params);
    const body = parse(marketMakerConfigSchema, req.body);
    await upsertMarketMakerConfig(pool, actor(req), ticker, body);
    return { ok: true };
  });
  app.post('/market-maker/:ticker/open', async (req) => {
    const { ticker } = parse(tickerParam, req.params);
    const r = await openLiquidity(pool, actor(req), ticker);
    ctx.kickOutbox();
    return r;
  });

  /* ------------------------------- Orders ------------------------------- */
  app.post('/orders/:id/cancel', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const order = await cancelOrder(pool, { orderId: id, actorUserId: req.user!.id, actorIsAdmin: true, reason: 'ADMIN_CANCELLED' });
    await audit(pool, { actorUserId: req.user!.id, action: 'ORDER_ADMIN_CANCEL', targetType: 'order', targetId: id, ip: req.ip });
    ctx.kickOutbox();
    return { order };
  });

  /* ------------------------- Inspection / ledgers ------------------------ */
  app.get('/trades', async (req) => {
    const q = parse(paginationSchema.extend({ ticker: z.string().max(8).optional(), userId: z.uuid().optional() }), req.query);
    const r = await pool.query(
      `SELECT id, ticker, price_cents, quantity, buy_order_id, sell_order_id, buyer_id, seller_id, maker_order_id, taker_order_id,
              aggressor_side, executed_at
         FROM trades
        WHERE ($1::text IS NULL OR ticker = upper($1)) AND ($2::uuid IS NULL OR buyer_id = $2 OR seller_id = $2)
          AND ($4::bigint IS NULL OR id < $4)
        ORDER BY id DESC LIMIT $3`,
      [q.ticker ?? null, q.userId ?? null, q.limit, q.before ?? null],
    );
    return { trades: r.rows };
  });
  app.get('/ledger/cash', async (req) => {
    const q = parse(userQuery, req.query);
    return { entries: await cashLedgerFor(pool, q.userId ?? null, q.limit, q.before) };
  });
  app.get('/ledger/positions', async (req) => {
    const q = parse(userQuery, req.query);
    return { entries: await positionLedgerFor(pool, q.userId ?? null, q.limit, q.before) };
  });
  app.get('/issuance', async () => {
    const r = await pool.query(`SELECT * FROM security_issuance ORDER BY id DESC LIMIT 500`);
    return { issuance: r.rows };
  });
  app.get('/halts', async () => {
    const r = await pool.query(`SELECT * FROM trading_halts ORDER BY id DESC LIMIT 200`);
    return { halts: r.rows };
  });
  app.get('/audit-logs', async (req) => {
    const q = parse(paginationSchema, req.query);
    const r = await pool.query(
      `SELECT id, actor_user_id, action, target_type, target_id, details, ip, created_at FROM audit_logs
        WHERE ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT $1`,
      [q.limit, q.before ?? null],
    );
    return { entries: r.rows.map((e) => ({ ...e, created_at: iso(e.created_at as Date) })) };
  });
  app.get('/integrity', async () => checkIntegrity(pool));

  /* --------------------------- Simulation reset -------------------------- */
  app.post('/simulation/reset', { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } }, async (req) => {
    const body = parse(simulationResetSchema, req.body);
    const r = await resetSimulation(pool, {
      adminId: req.user!.id,
      adminPassword: body.password,
      reason: body.reason,
      ip: req.ip,
      startingCashCents: cfg.STARTING_CASH_CENTS,
      marketMakerCashCents: cfg.MARKET_MAKER_STARTING_CASH_CENTS,
    });
    ctx.kickOutbox();
    return r;
  });
  app.get('/simulation/resets', async () => {
    const r = await pool.query(`SELECT * FROM simulation_resets ORDER BY id DESC`);
    return { resets: r.rows };
  });
}
