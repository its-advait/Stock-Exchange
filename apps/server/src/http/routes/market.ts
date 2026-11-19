import { historyQuerySchema, paginationSchema } from '@aez/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getOrderBook } from '../../engine/book.js';
import { notFound } from '../../lib/errors.js';
import { getSecurity, listSecurities, marketStatus, movers, priceHistory, recentTrades } from '../../services/market.js';
import { leaderboard } from '../../services/portfolio.js';
import { parse, tickerParam, type AppContext } from '../context.js';

export async function marketRoutes(app: FastifyInstance, ctx: AppContext) {
  const { pool, cfg } = ctx;

  app.get('/market/status', async () => marketStatus(pool));

  app.get('/securities', async (req) => {
    const q = parse(z.object({ q: z.string().max(64).optional() }), req.query);
    return { securities: await listSecurities(pool, q.q) };
  });

  app.get('/securities/:ticker', async (req) => {
    const { ticker } = parse(tickerParam, req.params);
    return { security: await getSecurity(pool, ticker) };
  });

  app.get('/securities/:ticker/book', async (req) => {
    const { ticker } = parse(tickerParam, req.params);
    const { depth } = parse(z.object({ depth: z.coerce.number().int().min(1).max(50).default(10) }), req.query);
    const exists = await pool.query(`SELECT 1 FROM securities WHERE ticker = $1`, [ticker]);
    if (exists.rowCount === 0) throw notFound('Security');
    return { book: await getOrderBook(pool, ticker, depth) };
  });

  app.get('/securities/:ticker/trades', async (req) => {
    const { ticker } = parse(tickerParam, req.params);
    const p = parse(paginationSchema, req.query);
    return { trades: await recentTrades(pool, ticker, p.limit, p.before) };
  });

  app.get('/securities/:ticker/history', async (req) => {
    const { ticker } = parse(tickerParam, req.params);
    const q = parse(historyQuerySchema, req.query);
    return priceHistory(pool, ticker, q);
  });

  app.get('/market/movers', async (req) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(45).default(5) }), req.query);
    return movers(pool, limit);
  });

  app.get('/leaderboard', async (req) => {
    const q = parse(
      z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }),
      req.query,
    );
    return { entries: await leaderboard(pool, cfg.STARTING_CASH_CENTS, q.limit, q.offset) };
  });
}
