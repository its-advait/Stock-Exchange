import { paginationSchema, portfolioRangeSchema } from '@aez/shared';
import { z } from 'zod';
import { addToWatchlist, getWatchlist, removeFromWatchlist } from '../../services/content.js';
import { portfolioHistory } from '../../services/insights.js';
import type { FastifyInstance } from 'fastify';
import { cashLedgerFor, myTrades, portfolio, positionLedgerFor } from '../../services/portfolio.js';
import { parse, requireUser, tickerParam, type AppContext } from '../context.js';

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

  /** Account value over time, reconstructed from the ledgers and real executions. */
  app.get('/portfolio/history', async (req) => {
    const user = requireUser(req);
    const { range } = parse(z.object({ range: portfolioRangeSchema.default('1W') }), req.query);
    return { history: await portfolioHistory(pool, user.id, range, cfg.STARTING_CASH_CENTS) };
  });

  app.get('/watchlist', async (req) => {
    const user = requireUser(req);
    return { tickers: await getWatchlist(pool, user.id) };
  });
  app.put('/watchlist/:ticker', async (req) => {
    const user = requireUser(req);
    const { ticker } = parse(tickerParam, req.params);
    return { tickers: await addToWatchlist(pool, user.id, ticker) };
  });
  app.delete('/watchlist/:ticker', async (req) => {
    const user = requireUser(req);
    const { ticker } = parse(tickerParam, req.params);
    return { tickers: await removeFromWatchlist(pool, user.id, ticker) };
  });
}
