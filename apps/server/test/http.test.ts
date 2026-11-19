import type { AddressInfo } from 'node:net';
import { RESET_CONFIRMATION_PHRASE, SIMULATION_ACKNOWLEDGEMENT } from '@aez/shared';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type RunningServer } from '../src/server.js';
import { activate, grantShares, makeUser, newPool, resetDatabase, testConfig } from './helpers.js';

let srv: RunningServer;
const T = 'TMAN';
const ORIGIN = 'http://localhost:5173';
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

function cookieOf(res: { cookies: { name: string; value: string }[] }): string {
  const c = res.cookies.find((x) => x.name === 'aez_session');
  if (!c) throw new Error('no session cookie');
  return `aez_session=${c.value}`;
}

async function register(username: string) {
  const res = await srv.app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: PASSWORD } });
  expect(res.statusCode).toBe(201);
  return { cookie: cookieOf(res), user: res.json().user as { id: string } };
}

async function loginAs(username: string) {
  const res = await srv.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: PASSWORD } });
  expect(res.statusCode).toBe(200);
  return cookieOf(res);
}

const order = (cookie: string, payload: unknown, key: string) =>
  srv.app.inject({ method: 'POST', url: '/api/orders', headers: { cookie, 'idempotency-key': key }, payload: payload as object });

describe('auth', () => {
  it('register grants exactly $10,000, sets a secure-by-default httpOnly cookie, and never leaks hashes', async () => {
    const res = await srv.app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'alice_1', password: PASSWORD } });
    expect(res.statusCode).toBe(201);
    const c = res.cookies.find((x) => x.name === 'aez_session')!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Lax');
    expect(res.body).not.toMatch(/argon2|password/i);
    const cookie = `aez_session=${c.value}`;
    const pf = await srv.app.inject({ method: 'GET', url: '/api/portfolio', headers: { cookie } });
    expect(pf.json().portfolio).toMatchObject({ cashCents: 1_000_000, reservedCashCents: 0, availableCashCents: 1_000_000, totalPnlCents: 0, rank: 1 });
    // The DB stores only a SHA-256 of the token, never the token itself.
    const s = await srv.pool.query(`SELECT id FROM sessions`);
    expect(s.rows[0].id).not.toBe(c.value);
    expect(s.rows[0].id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects duplicate usernames (case-insensitive) and weak passwords', async () => {
    await register('bob_2');
    const dup = await srv.app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'BOB_2', password: PASSWORD } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('USERNAME_TAKEN');
    const weak = await srv.app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'carol', password: 'short' } });
    expect(weak.statusCode).toBe(400);
  });

  it('login/logout/me lifecycle with uniform failure messages', async () => {
    await register('dave_3');
    const bad = await srv.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'dave_3', password: 'wrong password!!' } });
    const unknown = await srv.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'nobody', password: 'wrong password!!' } });
    expect(bad.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(bad.json()).toEqual(unknown.json());
    const cookie = await loginAs('dave_3');
    expect((await srv.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json().user.username).toBe('dave_3');
    expect((await srv.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })).statusCode).toBe(204);
    expect((await srv.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('state persists across logins ("return the next day")', async () => {
    const { cookie } = await register('erin_4');
    await order(cookie, { ticker: T, side: 'BUY', type: 'LIMIT', quantity: 3, limitPriceCents: 900 }, 'persist-key-1');
    await srv.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    const again = await loginAs('erin_4');
    const pf = (await srv.app.inject({ method: 'GET', url: '/api/portfolio', headers: { cookie: again } })).json().portfolio;
    expect(pf.reservedCashCents).toBe(2700);
    expect(pf.openOrders).toHaveLength(1);
  });

  it('rejects cross-origin state-changing requests and non-JSON bodies', async () => {
    const res = await srv.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { origin: 'https://evil.example' },
      payload: { username: 'mallory', password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    const txt = await srv.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'text/plain' },
      payload: 'username=x&password=y',
    });
    expect(txt.statusCode).toBe(415);
  });
});

describe('orders over HTTP', () => {
  it('requires authentication and an Idempotency-Key; validates bodies', async () => {
    expect((await srv.app.inject({ method: 'POST', url: '/api/orders', payload: {} })).statusCode).toBe(401);
    const { cookie } = await register('frank_5');
    const noKey = await srv.app.inject({ method: 'POST', url: '/api/orders', headers: { cookie }, payload: { ticker: T, side: 'BUY', type: 'LIMIT', quantity: 1, limitPriceCents: 1 } });
    expect(noKey.statusCode).toBe(400);
    const float = await order(cookie, { ticker: T, side: 'BUY', type: 'LIMIT', quantity: 1.5, limitPriceCents: 100 }, 'key-float-1');
    expect(float.statusCode).toBe(400);
    const mktNoBudget = await order(cookie, { ticker: T, side: 'BUY', type: 'MARKET', quantity: 1 }, 'key-mkt-1');
    expect(mktNoBudget.statusCode).toBe(400);
    const wallet = await srv.app.inject({ method: 'POST', url: '/api/portfolio', headers: { cookie }, payload: { cashCents: 1e9 } });
    expect(wallet.statusCode).toBe(404); // there is no endpoint that changes wallet balances
  });

  it('places, matches, replays idempotently, cancels; reflects in portfolio/trades/leaderboard', async () => {
    const seller = await register('seller_6');
    const buyer = await register('buyer_7');
    await grantShares(srv.pool, T, seller.user.id, 10n);
    const ask = await order(seller.cookie, { ticker: T, side: 'SELL', type: 'LIMIT', quantity: 10, limitPriceCents: 1200 }, 'ask-key-001');
    expect(ask.statusCode).toBe(201);
    const buy1 = await order(buyer.cookie, { ticker: T, side: 'BUY', type: 'MARKET', quantity: 4, maxSpendCents: 10_000 }, 'buy-key-001');
    const buy2 = await order(buyer.cookie, { ticker: T, side: 'BUY', type: 'MARKET', quantity: 4, maxSpendCents: 10_000 }, 'buy-key-001');
    expect(buy1.statusCode).toBe(201);
    expect(buy1.json().order.status).toBe('FILLED');
    expect(buy2.json().replayed).toBe(true);
    expect(buy2.json().order.id).toBe(buy1.json().order.id);
    const reuse = await order(buyer.cookie, { ticker: T, side: 'BUY', type: 'MARKET', quantity: 5, maxSpendCents: 10_000 }, 'buy-key-001');
    expect(reuse.statusCode).toBe(409);

    const book = (await srv.app.inject({ method: 'GET', url: `/api/securities/${T}/book` })).json().book;
    expect(book.asks).toEqual([{ priceCents: 1200, quantity: 6, orders: 1 }]);
    const sec = (await srv.app.inject({ method: 'GET', url: `/api/securities/${T}` })).json().security;
    expect(sec).toMatchObject({ lastPriceCents: 1200, displayPriceKind: 'LAST_TRADE', changeFromReferenceBps: 2000, volume24h: 4 });
    const trades = (await srv.app.inject({ method: 'GET', url: `/api/securities/${T}/trades` })).json().trades;
    expect(trades).toHaveLength(1);
    const hist = (await srv.app.inject({ method: 'GET', url: `/api/securities/${T}/history?interval=1m` })).json();
    expect(hist.points).toHaveLength(1);
    expect(hist.points[0]).toMatchObject({ openCents: 1200, closeCents: 1200, volume: 4 });

    const pf = (await srv.app.inject({ method: 'GET', url: '/api/portfolio', headers: { cookie: buyer.cookie } })).json().portfolio;
    expect(pf).toMatchObject({ cashCents: 1_000_000 - 4800, holdingsValueCents: 4800, totalPnlCents: 0 });
    expect(pf.holdings[0]).toMatchObject({ ticker: T, quantity: 4, costBasisCents: 4800, markPriceKind: 'LAST_TRADE' });
    const myTrades = (await srv.app.inject({ method: 'GET', url: '/api/account/trades', headers: { cookie: buyer.cookie } })).json().trades;
    expect(myTrades[0]).toMatchObject({ side: 'BUY', liquidity: 'TAKER', notionalCents: 4800 });
    const ledger = (await srv.app.inject({ method: 'GET', url: '/api/account/ledger/cash', headers: { cookie: buyer.cookie } })).json().entries;
    expect(ledger.map((e: { reason: string }) => e.reason)).toEqual(['TRADE_BUY', 'INITIAL_GRANT']);

    const lb = (await srv.app.inject({ method: 'GET', url: '/api/leaderboard' })).json().entries;
    expect(lb[0]).toMatchObject({ username: 'seller_6', rank: 1 }); // seller holds 6 shares @1200 + cash
    expect(lb.some((e: { username: string }) => e.username === 'aez_market_maker')).toBe(false);

    // Another user cannot cancel the seller's order; the owner can.
    const askId = ask.json().order.id;
    expect((await srv.app.inject({ method: 'DELETE', url: `/api/orders/${askId}`, headers: { cookie: buyer.cookie } })).statusCode).toBe(404);
    const cancel = await srv.app.inject({ method: 'DELETE', url: `/api/orders/${askId}`, headers: { cookie: seller.cookie } });
    expect(cancel.json().order).toMatchObject({ status: 'CANCELLED', filledQuantity: 4 });
    // Other users' orders are invisible.
    expect((await srv.app.inject({ method: 'GET', url: `/api/orders/${askId}`, headers: { cookie: buyer.cookie } })).statusCode).toBe(404);
  });

  it('a rejected order returns 422 with the recorded rejection', async () => {
    const { cookie } = await register('gina_8');
    const r = await order(cookie, { ticker: T, side: 'SELL', type: 'LIMIT', quantity: 1, limitPriceCents: 100 }, 'reject-key-1');
    expect(r.statusCode).toBe(422);
    expect(r.json().order).toMatchObject({ status: 'REJECTED', rejectReason: 'INSUFFICIENT_SHARES' });
  });
});

describe('admin', () => {
  it('admin endpoints require ADMIN role', async () => {
    const { cookie } = await register('henry_9');
    expect((await srv.app.inject({ method: 'GET', url: '/api/admin/users' })).statusCode).toBe(401);
    expect((await srv.app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie } })).statusCode).toBe(403);
    expect((await srv.app.inject({ method: 'POST', url: '/api/admin/market/halt', headers: { cookie }, payload: { reason: 'nope' } })).statusCode).toBe(403);
  });

  it('full admin flow: simulated reference, market-maker liquidity, halt, protected reset', async () => {
    await makeUser(srv.pool, 'root_admin', 'ADMIN');
    const admin = await loginAs('root_admin');
    const h = { cookie: admin };
    // Create a user via admin.
    const created = await srv.app.inject({ method: 'POST', url: '/api/admin/users', headers: h, payload: { username: 'ivy_10', password: PASSWORD } });
    expect(created.statusCode).toBe(201);
    // Simulated reference requires the exact acknowledgement.
    const badAck = await srv.app.inject({
      method: 'POST',
      url: '/api/admin/securities/ALI/simulated-reference',
      headers: h,
      payload: { referencePriceCents: 1500, activate: true, note: 'trial run', acknowledgement: 'yes' },
    });
    expect(badAck.statusCode).toBe(400);
    const sim = await srv.app.inject({
      method: 'POST',
      url: '/api/admin/securities/ALI/simulated-reference',
      headers: h,
      payload: { referencePriceCents: 1500, activate: true, note: 'trial run', acknowledgement: SIMULATION_ACKNOWLEDGEMENT },
    });
    expect(sim.statusCode).toBe(200);
    // Configure + open liquidity.
    const cfg = await srv.app.inject({
      method: 'PUT',
      url: '/api/admin/market-maker/ALI',
      headers: h,
      payload: { inventoryShares: 300, askLevels: [{ offsetBps: 0, quantity: 100 }, { offsetBps: 200, quantity: 200 }], bidLevels: [{ offsetBps: -200, quantity: 50 }], note: 'opening book' },
    });
    expect(cfg.statusCode).toBe(200);
    const open = await srv.app.inject({ method: 'POST', url: '/api/admin/market-maker/ALI/open', headers: h });
    expect(open.statusCode).toBe(200);
    expect(open.json().issuedShares).toBe(300);
    const again = await srv.app.inject({ method: 'POST', url: '/api/admin/market-maker/ALI/open', headers: h });
    expect(again.json().error.code).toBe('ALREADY_OPENED');
    const book = (await srv.app.inject({ method: 'GET', url: '/api/securities/ALI/book' })).json().book;
    expect(book.asks).toEqual([
      { priceCents: 1500, quantity: 100, orders: 1 },
      { priceCents: 1530, quantity: 200, orders: 1 },
    ]);
    expect(book.bids).toEqual([{ priceCents: 1470, quantity: 50, orders: 1 }]);
    // Market maker cash reserved for its bid; inventory reserved for its asks.
    const mm = (await srv.app.inject({ method: 'GET', url: '/api/admin/market-maker', headers: h })).json();
    expect(mm.account.reservedCashCents).toBe(50 * 1470);
    expect(mm.inventory).toEqual([{ ticker: 'ALI', quantity: 300, reservedQuantity: 300 }]);
    // A user buys from the market maker.
    const ivy = await loginAs('ivy_10');
    const b = await order(ivy, { ticker: 'ALI', side: 'BUY', type: 'MARKET', quantity: 150, maxSpendCents: 300_000 }, 'ivy-buy-0001');
    expect(b.json().fills.map((f: { priceCents: number; quantity: number }) => [f.priceCents, f.quantity])).toEqual([
      [1500, 100],
      [1530, 50],
    ]);
    const integ = (await srv.app.inject({ method: 'GET', url: '/api/admin/integrity', headers: h })).json();
    expect(integ.violations).toEqual([]);

    // Reset: requires halt, exact phrase, and password re-entry.
    const resetBody = { confirmation: RESET_CONFIRMATION_PHRASE, password: PASSWORD, reason: 'Start of semester' };
    const notHalted = await srv.app.inject({ method: 'POST', url: '/api/admin/simulation/reset', headers: h, payload: resetBody });
    expect(notHalted.json().error.code).toBe('MARKET_NOT_HALTED');
    await srv.app.inject({ method: 'POST', url: '/api/admin/market/halt', headers: h, payload: { reason: 'reset prep' } });
    const wrongPhrase = await srv.app.inject({ method: 'POST', url: '/api/admin/simulation/reset', headers: h, payload: { ...resetBody, confirmation: 'reset' } });
    expect(wrongPhrase.statusCode).toBe(400);
    const wrongPw = await srv.app.inject({ method: 'POST', url: '/api/admin/simulation/reset', headers: h, payload: { ...resetBody, password: 'not my password' } });
    expect(wrongPw.statusCode).toBe(401);
    const reset = await srv.app.inject({ method: 'POST', url: '/api/admin/simulation/reset', headers: h, payload: resetBody });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ previousEpoch: 1, newEpoch: 2 });
    const pf = (await srv.app.inject({ method: 'GET', url: '/api/portfolio', headers: { cookie: ivy } })).json().portfolio;
    expect(pf).toMatchObject({ cashCents: 1_000_000, holdings: [], openOrders: [] });
    const sec = (await srv.app.inject({ method: 'GET', url: '/api/securities/ALI' })).json().security;
    expect(sec.lastPriceCents).toBeNull();
    const integ2 = (await srv.app.inject({ method: 'GET', url: '/api/admin/integrity', headers: h })).json();
    expect(integ2.violations).toEqual([]);
    // Issuance history survives (immutable) but belongs to the old epoch.
    const iss = (await srv.app.inject({ method: 'GET', url: '/api/admin/issuance', headers: h })).json().issuance;
    expect(iss).toHaveLength(1);
    expect(iss[0].epoch).toBe(1);
  });
});

describe('socket.io', () => {
  it('delivers public ticker events to subscribers and account events only to the owner', async () => {
    await srv.relay.start();
    await srv.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (srv.app.server.address() as AddressInfo).port;
    const seller = await register('sock_seller');
    const buyer = await register('sock_buyer');
    await grantShares(srv.pool, T, seller.user.id, 5n);

    const connect = (cookie?: string) =>
      new Promise<Socket>((resolve, reject) => {
        const s = ioClient(`http://127.0.0.1:${port}`, {
          path: '/socket.io',
          transports: ['websocket'],
          extraHeaders: { origin: ORIGIN, ...(cookie ? { cookie } : {}) },
        });
        s.on('connect', () => resolve(s));
        s.on('connect_error', reject);
      });
    const anon = await connect();
    const buyerSock = await connect(buyer.cookie);
    const subscribed = await new Promise((r) => anon.emit('subscribe', [T, 'NOPE'], r));
    expect(subscribed).toEqual({ ok: true, subscribed: [T] });

    const anonTrades: unknown[] = [];
    const anonOrders: unknown[] = [];
    const buyerOrders: { order: { status: string } }[] = [];
    anon.on('trade', (e) => anonTrades.push(e));
    anon.on('order', (e) => anonOrders.push(e));
    buyerSock.on('order', (e) => buyerOrders.push(e));

    await order(seller.cookie, { ticker: T, side: 'SELL', type: 'LIMIT', quantity: 5, limitPriceCents: 1000 }, 'sock-ask-1');
    await order(buyer.cookie, { ticker: T, side: 'BUY', type: 'LIMIT', quantity: 5, limitPriceCents: 1000 }, 'sock-bid-1');
    await srv.relay.kick();
    await new Promise((r) => setTimeout(r, 300));

    expect(anonTrades).toHaveLength(1);
    expect(anonTrades[0]).toMatchObject({ ticker: T, trade: { priceCents: 1000, quantity: 5 } });
    expect(anonOrders).toHaveLength(0);
    expect(buyerOrders.map((e) => e.order.status)).toEqual(['FILLED']);
    anon.close();
    buyerSock.close();
  });
});
