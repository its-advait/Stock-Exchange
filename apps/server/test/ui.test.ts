import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type RunningServer } from '../src/server.js';
import { seedNews } from '../src/services/content.js';
import { activate, grantShares, newPool, resetDatabase, testConfig } from './helpers.js';

let srv: RunningServer;
const T = 'GANDH';
const PASSWORD = 'correct horse battery';

beforeAll(async () => {
  srv = await createServer(testConfig(), newPool());
});
afterAll(async () => {
  await srv.close();
});
beforeEach(async () => {
  await resetDatabase(srv.pool);
  await activate(srv.pool, T, 1000n);
});

async function register(username: string, role?: 'ADMIN') {
  const res = await srv.app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: PASSWORD } });
  expect(res.statusCode).toBe(201);
  const id = res.json().user.id as string;
  if (role) await srv.pool.query(`UPDATE users SET role = 'ADMIN' WHERE id = $1`, [id]);
  const c = res.cookies.find((x) => x.name === 'aez_session')!;
  return { id, cookie: `aez_session=${c.value}` };
}
const get = (url: string, cookie?: string) => srv.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
const order = (cookie: string, payload: object, key: string) =>
  srv.app.inject({ method: 'POST', url: '/api/orders', headers: { cookie, 'idempotency-key': key }, payload });

describe('UI support endpoints', () => {
  it('records per-trade realized P&L and exposes leaderboards, trader profiles and portfolio history from real trades', async () => {
    const seller = await register('seller_1');
    const buyer = await register('buyer_1');
    await grantShares(srv.pool, T, seller.id, 10n);
    // Seller's basis is 0 (issued), so selling 4 @ $12 realizes $48.
    expect((await order(seller.cookie, { ticker: T, side: 'SELL', type: 'LIMIT', quantity: 4, limitPriceCents: 1200 }, 'k-sell-0001')).statusCode).toBe(201);
    const buy = await order(buyer.cookie, { ticker: T, side: 'BUY', type: 'MARKET', quantity: 4, maxSpendCents: 10_000 }, 'k-buy-00001');
    expect(buy.json().order.status).toBe('FILLED');

    const t = await srv.pool.query(`SELECT seller_realized_pnl_cents FROM trades`);
    expect(t.rows[0].seller_realized_pnl_cents).toBe(4800n);

    const boards = (await get('/api/leaderboard/boards')).json().boards;
    expect(boards.rankedUsers).toBe(2);
    expect(boards.topTrader.username).toBe('seller_1');
    expect(boards.biggestWins[0]).toMatchObject({ username: 'seller_1', realizedPnlCents: 4800, ticker: T });
    expect(boards.biggestLosses).toEqual([]);
    expect(boards.mostActive.map((r: { trades: number }) => r.trades)).toEqual([1, 1]);
    expect(boards.poorest[0].username).toBe('buyer_1');

    const prof = (await get('/api/traders/SELLER_1')).json().trader;
    expect(prof).toMatchObject({ username: 'seller_1', rank: 1, trades: 1, realizedPnlCents: 4800 });
    expect(JSON.stringify(prof)).not.toMatch(/cashCents|reserved|availableQuantity|password|orders/);
    expect((await get('/api/traders/nobody_here')).statusCode).toBe(404);

    const hist = (await get('/api/portfolio/history?range=1D', buyer.cookie)).json().history;
    expect(hist.points.length).toBeGreaterThan(1);
    // Last point equals the live portfolio total; first point is the $10,000 grant.
    const pf = (await get('/api/portfolio', buyer.cookie)).json().portfolio;
    expect(hist.points.at(-1).valueCents).toBe(pf.totalValueCents);
    expect(hist.points[0].valueCents).toBe(1_000_000);
    expect(pf.dayStartValueCents).toBe(1_000_000);
    expect(pf.dayChangeCents).toBe(pf.totalValueCents - 1_000_000);
    expect((await get('/api/portfolio/history')).statusCode).toBe(401);

    const sec = (await get(`/api/securities/${T}`)).json().security;
    expect(sec).toMatchObject({ trades24h: 1, volume24h: 4, price24hAgoCents: 1000, change24hCents: 200, change24hBps: 2000, sharesOutstanding: 10 });
    expect(sec.profile.sector).toBeTruthy();

    const tape = (await get('/api/market/trades?limit=5')).json().trades;
    expect(tape[0]).toMatchObject({ ticker: T, name: 'Neel Gandhi', quantity: 4, priceCents: 1200 });
    const summary = (await get('/api/market/summary')).json().summary;
    expect(summary).toMatchObject({ securities: 45, tradableSecurities: 1, tradedSecurities: 1, trades24h: 1, activeTraders24h: 2 });
  });

  it('watchlist is per-user, validated and persisted', async () => {
    const a = await register('watcher_a');
    const b = await register('watcher_b');
    const put = (c: string, t: string) => srv.app.inject({ method: 'PUT', url: `/api/watchlist/${t}`, headers: { cookie: c } });
    expect((await put(a.cookie, 'snig')).json().tickers).toEqual(['SNIG']);
    expect((await put(a.cookie, 'SNIG')).json().tickers).toEqual(['SNIG']);
    expect((await put(a.cookie, 'NOPE')).statusCode).toBe(404);
    expect((await get('/api/watchlist', b.cookie)).json().tickers).toEqual([]);
    const del = await srv.app.inject({ method: 'DELETE', url: '/api/watchlist/SNIG', headers: { cookie: a.cookie } });
    expect(del.json().tickers).toEqual([]);
    expect((await get('/api/watchlist')).statusCode).toBe(401);
  });

  it('news is parody-labeled, seeded idempotently, and only admins can post or hide', async () => {
    await seedNews(srv.pool);
    await seedNews(srv.pool);
    const list = (await get('/api/news?limit=50')).json().posts;
    expect(list).toHaveLength(10);
    expect(list.every((p: { parody: boolean; label: string }) => p.parody && p.label === 'Fictional AEZ Market News')).toBe(true);
    expect((await get('/api/news?ticker=GANDH')).json().posts[0].headline).toMatch(/Citadel/);

    const user = await register('plain_user');
    const admin = await register('news_admin', 'ADMIN');
    const payload = { ticker: 'MUNCH', headline: 'Pantry Restock Announced', body: 'Parody.' };
    expect((await srv.app.inject({ method: 'POST', url: '/api/admin/news', headers: { cookie: user.cookie }, payload })).statusCode).toBe(403);
    const created = await srv.app.inject({ method: 'POST', url: '/api/admin/news', headers: { cookie: admin.cookie }, payload });
    expect(created.statusCode).toBe(201);
    const id = created.json().post.id;
    expect((await get('/api/news?limit=50')).json().posts).toHaveLength(11);
    const hide = await srv.app.inject({ method: 'PATCH', url: `/api/admin/news/${id}`, headers: { cookie: admin.cookie }, payload: { hidden: true } });
    expect(hide.json().post.hidden).toBe(true);
    expect((await get('/api/news?limit=50')).json().posts).toHaveLength(10);
    const audit = await srv.pool.query(`SELECT action FROM audit_logs WHERE action LIKE 'NEWS_%' ORDER BY id`);
    expect(audit.rows.map((r) => r.action)).toEqual(['NEWS_CREATE', 'NEWS_HIDE']);
    const ev = await srv.pool.query(`SELECT room FROM outbox_events WHERE event = 'news'`);
    expect(ev.rows[0].room).toBe('market');
  });
});
