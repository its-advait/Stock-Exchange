import { paginationSchema } from '@aez/shared';
import type { FastifyInstance } from 'fastify';
import { cashLedgerFor, myTrades, portfolio, positionLedgerFor } from '../../services/portfolio.js';
import { parse, requireUser, type AppContext } from '../context.js';

export async function accountRoutes(app: FastifyInstance, ctx: AppContext) {
  const { pool, cfg } = ctx;

  /** Cash, reserved, available, holdings (marked), P&L, open orders and leaderboard rank. */
  app.get('/portfolio', async (req) => {
    const user = requireUser(req);
    return { portfolio: await portfolio(pool, user.id, cfg.STARTING_CASH_CENTS) };
  });

  app.get('/account/trades', async (req) => {
    const user = requireUser(req);
    const p = parse(paginationSchema, req.query);
    return { trades: await myTrades(pool, user.id, p.limit, p.before) };
  });

  app.get('/account/ledger/cash', async (req) => {
    const user = requireUser(req);
    const p = parse(paginationSchema, req.query);
    return { entries: await cashLedgerFor(pool, user.id, p.limit, p.before) };
  });

  app.get('/account/ledger/positions', async (req) => {
    const user = requireUser(req);
    const p = parse(paginationSchema, req.query);
    return { entries: await positionLedgerFor(pool, user.id, p.limit, p.before) };
  });
}
