/**
 * Final verification suite: one test per numbered requirement of the deployment
 * review (items 1-20), plus a randomized property test that checks the engine
 * against an independent in-memory reference model of the order book.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getOrderBook } from '../src/engine/book.js';
import { cancelOrder, placeOrder } from '../src/engine/matching.js';
import { getMarketMakerId } from '../src/services/accounts.js';
import { haltMarket, haltSymbol, resumeMarket, resumeSymbol } from '../src/services/halts.js';
import { getSecurity } from '../src/services/market.js';
import { openLiquidity, upsertMarketMakerConfig } from '../src/services/marketMaker.js';
import { portfolio } from '../src/services/portfolio.js';
import {
  activate,
  cashOf,
  expectIntegrity,
  grantShares,
  holdingOf,
  limit,
  makeUser,
  market,
  newPool,
  nextKey,
  place,
  resetDatabase,
  STARTING_CASH,
  tradesOf,
} from './helpers.js';

let pool = newPool();
const T = 'SHVM';

beforeEach(async () => {
  await resetDatabase(pool);
  await activate(pool, T, 1000n);
});
afterAll(() => pool.end());

const lastPrice = async (t = T) =>
  (await pool.query<{ last_price_cents: bigint | null }>(`SELECT last_price_cents FROM securities WHERE ticker = $1`, [t])).rows[0]!
    .last_price_cents;

describe('matching engine verification (items 1-20)', () => {
  it('1. two distinct authenticated users place matching limit orders and they execute', async () => {
    const [a, b] = [await makeUser(pool, 'trader_a'), await makeUser(pool, 'trader_b')];
    await grantShares(pool, T, a, 10n);
    const sell = await place(pool, limit(a, T, 'SELL', 10n, 4000n));
    expect(sell.order.status).toBe('OPEN');
    const buy = await place(pool, limit(b, T, 'BUY', 10n, 4000n));
    expect(buy.order.status).toBe('FILLED');
    expect(buy.fills).toEqual([{ tradeId: expect.any(Number), priceCents: 4000, quantity: 10, counterpartyOrderId: sell.order.id }]);
    const t = await tradesOf(pool, T);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ buyer_id: b, seller_id: a, price_cents: 4000n, quantity: 10n });
  });

  it('2. price-time priority: best price first, then earliest acceptance sequence; executes at resting price', async () => {
    const [s1, s2, s3, b] = [await makeUser(pool), await makeUser(pool), await makeUser(pool), await makeUser(pool)];
    for (const s of [s1, s2, s3]) await grantShares(pool, T, s, 10n);
    const o1 = await place(pool, limit(s1, T, 'SELL', 5n, 1010n)); // same price, earlier
    const o2 = await place(pool, limit(s2, T, 'SELL', 5n, 1010n)); // same price, later
    const o3 = await place(pool, limit(s3, T, 'SELL', 5n, 1000n)); // better price, latest
    const r = await place(pool, limit(b, T, 'BUY', 12n, 1050n));
    expect(r.fills.map((f) => [f.counterpartyOrderId, f.priceCents, f.quantity])).toEqual([
      [o3.order.id, 1000, 5],
      [o1.order.id, 1010, 5],
      [o2.order.id, 1010, 2],
    ]);
    // Bid side mirror: highest bid first.
    const [b1, b2, s] = [await makeUser(pool), await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 10n);
    const lo = await place(pool, limit(b1, T, 'BUY', 3n, 900n));
    const hi = await place(pool, limit(b2, T, 'BUY', 3n, 950n));
    const rs = await place(pool, limit(s, T, 'SELL', 4n, 800n));
    expect(rs.fills.map((f) => [f.counterpartyOrderId, f.priceCents, f.quantity])).toEqual([
      [hi.order.id, 950, 3],
      [lo.order.id, 900, 1],
    ]);
  });

  it('3. both users\' balances and holdings update exactly', async () => {
    const [a, b] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, a, 10n);
    await place(pool, limit(a, T, 'SELL', 10n, 4000n));
    await place(pool, limit(b, T, 'BUY', 10n, 4000n));
    expect(await cashOf(pool, a)).toEqual({ cash: STARTING_CASH + 40_000n, reserved: 0n });
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH - 40_000n, reserved: 0n });
    expect(await holdingOf(pool, a, T)).toEqual({ qty: 0n, reserved: 0n });
    expect(await holdingOf(pool, b, T)).toEqual({ qty: 10n, reserved: 0n });
    await expectIntegrity(pool);
  });

  it('4. multiple resting orders fill in sequence and the remainder rests', async () => {
    const sellers = [await makeUser(pool), await makeUser(pool), await makeUser(pool)];
    const ids: string[] = [];
    for (const s of sellers) {
      await grantShares(pool, T, s, 4n);
      ids.push((await place(pool, limit(s, T, 'SELL', 4n, 1000n))).order.id);
    }
    const b = await makeUser(pool);
    const r = await place(pool, limit(b, T, 'BUY', 15n, 1000n));
    expect(r.fills.map((f) => f.counterpartyOrderId)).toEqual(ids);
    expect(r.order).toMatchObject({ status: 'PARTIALLY_FILLED', filledQuantity: 12, remainingQuantity: 3 });
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH - 12_000n, reserved: 3_000n });
  });

  it('5. partial fills preserve the unfilled quantity and its reservation', async () => {
    const [s, b] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 10n);
    const ask = await place(pool, limit(s, T, 'SELL', 10n, 1000n));
    await place(pool, limit(b, T, 'BUY', 3n, 1000n));
    const o = (await pool.query(`SELECT status, quantity, filled_quantity, reserved_quantity FROM orders WHERE id = $1`, [ask.order.id])).rows[0];
    expect(o).toMatchObject({ status: 'PARTIALLY_FILLED', quantity: 10n, filled_quantity: 3n, reserved_quantity: 7n });
    expect(await holdingOf(pool, s, T)).toEqual({ qty: 7n, reserved: 7n });
    const book = await getOrderBook(pool, T);
    expect(book.asks).toEqual([{ priceCents: 1000, quantity: 7, orders: 1 }]);
  });

  it('6. unmatched limit orders remain open (bid below ask)', async () => {
    const [s, b] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 5n);
    const ask = await place(pool, limit(s, T, 'SELL', 5n, 1100n));
    const bid = await place(pool, limit(b, T, 'BUY', 5n, 1000n));
    expect([ask.order.status, bid.order.status]).toEqual(['OPEN', 'OPEN']);
    expect(await tradesOf(pool, T)).toHaveLength(0);
    const book = await getOrderBook(pool, T);
    expect([book.bestBidCents, book.bestAskCents]).toEqual([1000, 1100]);
  });

  it('7. unmatched market order quantity is cancelled and never rests', async () => {
    const [s, b] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 4n);
    await place(pool, limit(s, T, 'SELL', 4n, 1000n));
    const r = await place(pool, market(b, T, 'BUY', 10n, 50_000n));
    expect(r.order).toMatchObject({ status: 'CANCELLED', cancelReason: 'NO_LIQUIDITY', filledQuantity: 4 });
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH - 4_000n, reserved: 0n });
    const open = (await pool.query(`SELECT COUNT(*)::int n FROM orders WHERE type = 'MARKET' AND status IN ('OPEN','PARTIALLY_FILLED')`)).rows[0].n;
    expect(open).toBe(0);
    const ms = await place(pool, market(s, T, 'SELL', 1n)); // seller has 0 left -> rejected; nothing rests
    expect(ms.order.status).toBe('REJECTED');
  });

  it('8. reserved cash cannot be spent twice', async () => {
    const b = await makeUser(pool);
    expect((await place(pool, limit(b, T, 'BUY', 6n, 100_000n))).order.status).toBe('OPEN'); // reserves $6,000
    const second = await place(pool, limit(b, T, 'BUY', 5n, 100_000n)); // needs $5,000; only $4,000 available
    expect(second.order).toMatchObject({ status: 'REJECTED', rejectReason: 'INSUFFICIENT_FUNDS' });
    const mkt = await place(pool, market(b, T, 'BUY', 1n, 400_001n));
    expect(mkt.order.rejectReason).toBe('INSUFFICIENT_FUNDS');
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH, reserved: 600_000n });
  });

  it('9. reserved shares cannot be sold twice', async () => {
    const s = await makeUser(pool);
    await grantShares(pool, T, s, 10n);
    await place(pool, limit(s, T, 'SELL', 8n, 2000n));
    expect((await place(pool, limit(s, T, 'SELL', 3n, 2000n))).order.rejectReason).toBe('INSUFFICIENT_SHARES');
    expect((await place(pool, market(s, T, 'SELL', 3n))).order.rejectReason).toBe('INSUFFICIENT_SHARES');
    expect(await holdingOf(pool, s, T)).toEqual({ qty: 10n, reserved: 8n });
  });

  it('10. concurrent orders cannot create negative or over-reserved balances', async () => {
    const [b, s] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 1000n);
    await place(pool, limit(s, T, 'SELL', 1000n, 1000n));
    // 40 concurrent market buys, each with a $900 budget: only $10,000 exists.
    const rs = await Promise.all(Array.from({ length: 40 }, () => place(pool, market(b, T, 'BUY', 1n, 90_000n))));
    const filled = rs.filter((r) => r.order.status === 'FILLED').length;
    expect(filled).toBeLessThanOrEqual(100);
    // 40 concurrent limit buys reserving $3,000 each.
    await Promise.all(Array.from({ length: 40 }, () => place(pool, limit(b, T, 'BUY', 3n, 100_000n))));
    const c = await cashOf(pool, b);
    expect(c.cash).toBeGreaterThanOrEqual(0n);
    expect(c.reserved).toBeLessThanOrEqual(c.cash);
    const neg = (await pool.query(`SELECT COUNT(*)::int n FROM cash_accounts WHERE cash_cents < 0 OR reserved_cents > cash_cents`)).rows[0].n;
    expect(neg).toBe(0);
    await expectIntegrity(pool);
  });

  it('11. self-trade prevention: no execution against own resting order, no queue jumping', async () => {
    const [u, other, b] = [await makeUser(pool), await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, u, 10n);
    await grantShares(pool, T, other, 10n);
    await place(pool, limit(u, T, 'SELL', 5n, 1000n)); // own order, best price
    await place(pool, limit(other, T, 'SELL', 5n, 1010n)); // worse price
    const r = await place(pool, limit(u, T, 'BUY', 5n, 1100n));
    expect(r.fills).toEqual([]);
    expect(r.order).toMatchObject({ status: 'CANCELLED', cancelReason: 'SELF_TRADE_PREVENTION' });
    expect((await tradesOf(pool, T)).filter((t) => t.buyer_id === t.seller_id)).toHaveLength(0);
    // Someone else can still take both.
    const rb = await place(pool, limit(b, T, 'BUY', 10n, 1100n));
    expect(rb.fills.map((f) => f.priceCents)).toEqual([1000, 1010]);
  });

  it('12. cancellation releases exactly the remaining reservation', async () => {
    const [b, s] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 20n);
    const bid = await place(pool, limit(b, T, 'BUY', 10n, 1200n));
    await place(pool, limit(s, T, 'SELL', 4n, 1100n)); // fills 4 at the bid's 1200
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH - 4_800n, reserved: 7_200n });
    await cancelOrder(pool, { orderId: bid.order.id, actorUserId: b });
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH - 4_800n, reserved: 0n });
    const ask = await place(pool, limit(s, T, 'SELL', 9n, 1500n));
    expect(await holdingOf(pool, s, T)).toEqual({ qty: 16n, reserved: 9n });
    await cancelOrder(pool, { orderId: ask.order.id, actorUserId: s });
    expect(await holdingOf(pool, s, T)).toEqual({ qty: 16n, reserved: 0n });
    await expect(cancelOrder(pool, { orderId: ask.order.id, actorUserId: s })).rejects.toMatchObject({ code: 'ORDER_NOT_OPEN' });
    await expectIntegrity(pool);
  });

  it('13. a retried request (same Idempotency-Key) never creates a duplicate order', async () => {
    const [b, s] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 10n);
    await place(pool, limit(s, T, 'SELL', 10n, 1000n));
    const key = nextKey();
    const input = market(b, T, 'BUY', 2n, 5_000n, key);
    const [r1, r2, r3] = await Promise.all([placeOrder(pool, input), placeOrder(pool, input), placeOrder(pool, input)]);
    const r4 = await placeOrder(pool, input);
    const ids = new Set([r1, r2, r3, r4].map((r) => r.body.order.id));
    expect(ids.size).toBe(1);
    expect((await pool.query(`SELECT COUNT(*)::int n FROM orders WHERE user_id = $1`, [b])).rows[0].n).toBe(1);
    expect(await tradesOf(pool, T)).toHaveLength(1);
    expect(await cashOf(pool, b)).toEqual({ cash: STARTING_CASH - 2_000n, reserved: 0n });
  });

  it('14. a failure inside an execution rolls back every related change', async () => {
    const [b, s] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 10n);
    await place(pool, limit(s, T, 'SELL', 10n, 1000n));
    const snapshot = async () =>
      (
        await pool.query(`SELECT
          (SELECT COUNT(*) FROM trades) t, (SELECT COUNT(*) FROM orders) o, (SELECT COUNT(*) FROM cash_ledger) cl,
          (SELECT COUNT(*) FROM position_ledger) pl, (SELECT COUNT(*) FROM outbox_events) ob, (SELECT COUNT(*) FROM price_history) ph,
          (SELECT COUNT(*) FROM idempotency_keys) ik, (SELECT SUM(cash_cents) FROM cash_accounts) cash,
          (SELECT SUM(reserved_quantity) FROM holdings) rq, (SELECT last_price_cents FROM securities WHERE ticker = '${T}') lp,
          (SELECT book_version FROM securities WHERE ticker = '${T}') bv`)
      ).rows[0];
    const before = await snapshot();
    await expect(
      placeOrder(pool, limit(b, T, 'BUY', 5n, 1000n), {
        beforeCommit: () => {
          throw new Error('injected failure');
        },
      }),
    ).rejects.toThrow('injected failure');
    expect(await snapshot()).toEqual(before);
    await expectIntegrity(pool);
  });

  it('15. trading halts are enforced (market-wide and per symbol) and cancels still work', async () => {
    const admin = await makeUser(pool, 'admin_x', 'ADMIN');
    const b = await makeUser(pool);
    const resting = await place(pool, limit(b, T, 'BUY', 1n, 900n));
    await haltMarket(pool, { adminId: admin }, 'verification halt');
    expect((await place(pool, limit(b, T, 'BUY', 1n, 900n))).order.rejectReason).toBe('MARKET_HALTED');
    expect((await cancelOrder(pool, { orderId: resting.order.id, actorUserId: b })).status).toBe('CANCELLED');
    await resumeMarket(pool, { adminId: admin }, 'verification resume');
    await haltSymbol(pool, { adminId: admin }, T, 'symbol halt');
    expect((await place(pool, limit(b, T, 'BUY', 1n, 900n))).order.rejectReason).toBe('SYMBOL_HALTED');
    await resumeSymbol(pool, { adminId: admin }, T, 'symbol resume');
    expect((await place(pool, limit(b, T, 'BUY', 1n, 900n))).order.status).toBe('OPEN');
  });

  it('16. the last price changes only after an execution', async () => {
    const [b, s] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 10n);
    expect(await lastPrice()).toBeNull();
    const ask = await place(pool, limit(s, T, 'SELL', 5n, 1300n)); // rests
    await place(pool, limit(b, T, 'BUY', 5n, 1200n)); // rests
    await place(pool, limit(b, T, 'BUY', 500n, 100_000n)); // rejected
    await place(pool, market(b, T, 'BUY', 1n, 1_000n)); // budget too small for 1300: cancelled, no fill
    await cancelOrder(pool, { orderId: ask.order.id, actorUserId: s });
    expect(await lastPrice()).toBeNull();
    expect((await getSecurity(pool, T)).displayPriceKind).not.toBe('LAST_TRADE');
    await place(pool, limit(s, T, 'SELL', 2n, 1150n)); // hits the 1200 bid
    expect(await lastPrice()).toBe(1200n);
    expect((await getSecurity(pool, T)).displayPriceKind).toBe('LAST_TRADE');
    const hist = (await pool.query(`SELECT price_cents FROM price_history WHERE ticker = $1`, [T])).rows;
    expect(hist).toEqual([{ price_cents: 1200n }]);
  });

  it('17. a restart preserves orders, trades, balances, ledgers and price history', async () => {
    const [b, s] = [await makeUser(pool), await makeUser(pool)];
    await grantShares(pool, T, s, 20n);
    await place(pool, limit(s, T, 'SELL', 10n, 1000n));
    await place(pool, limit(b, T, 'BUY', 4n, 1000n));
    await place(pool, limit(b, T, 'BUY', 3n, 900n));
    const capture = async () => ({
      orders: (await pool.query(`SELECT id, status, filled_quantity, reserved_cents, reserved_quantity, seq FROM orders ORDER BY seq`)).rows,
      trades: (await pool.query(`SELECT * FROM trades ORDER BY id`)).rows,
      cash: (await pool.query(`SELECT user_id, cash_cents, reserved_cents FROM cash_accounts ORDER BY user_id`)).rows,
      holdings: (await pool.query(`SELECT * FROM holdings ORDER BY user_id, ticker`)).rows,
      cashLedger: (await pool.query(`SELECT * FROM cash_ledger ORDER BY id`)).rows,
      history: (await pool.query(`SELECT * FROM price_history ORDER BY id`)).rows,
      portfolio: await portfolio(pool, b, STARTING_CASH),
    });
    const before = await capture();
    await pool.end(); // process exit: every in-memory structure is gone
    pool = newPool();
    const after = await capture();
    expect(after).toEqual(before);
    expect(after.trades).toHaveLength(1);
    // Matching resumes from the durable book.
    const r = await place(pool, limit(b, T, 'BUY', 6n, 1000n));
    expect(r.order.status).toBe('FILLED');
    await expectIntegrity(pool);
  });

  it('18. all 45 securities exist with exactly the specified names and tickers', async () => {
    // Independent copy of the assignment table (not imported from the app's own universe file).
    const SPEC = `Abhinav Jinka JINK|Til Kareht TMAN|Andrew Li ALI|Aditya Mehta AMET|Neel Sijp NSJP|Aarya Srinivasan SRVSN|Abhinav Bellapu BLPU|Gowri Biju BIJU|Tanay Doppalapudi DOPP|Suvan Kapoor SUVN|Arjun Parmar PARM|Arya Patel ARYA|Shivm Patel SHVM|Yadukrishna Raghu YADU|Aaron Ratnavel ARAT|Vikram Ravi VIKR|Neel Gandhi GANDH|Atul Kamath ATUL|Ayan Kawlekar AYAN|Ethan Lau LAU|Srithan Meeniga STHAN|Mohith Ram Narendra Babu BABU|Reyansh Pallikonda RPAL|Rohin Prashanth RKP|Varun Rao VRAN|Zahm Siyed JAHM|Laiq Sorrell MUNCH|Nidhish Tekkam TEKK|Dhruv Vallurupalli DVAL|Aadi Agrawal IPPAG|Neelesh Bokkisam BOKKI|Neil Kamath KAMT|Abhinav Mukkamala MOOKIE|Sreekar Nagulapalli SNIG|Aayush Shah ASHAH|Kanishk Vankayala KANS|Kabir Dua KDUA|Siddarth Kasi SSKGP|Adith Mohanty MOHNT|Samhith Padala PDAL|Praneel Pantula PRANS|Zain Passi ZAIN|Sebastian Reddy REDY|Bartev Stepanian STEP|Joshua Thomas JTOM`
      .split('|')
      .map((e, i) => {
        const parts = e.split(' ');
        return { rank: i + 1, ticker: parts.pop()!, name: parts.join(' ') };
      });
    expect(SPEC).toHaveLength(45);
    const rows = (await pool.query<{ ticker: string; name: string; original_rank: number }>(`SELECT ticker, name, original_rank FROM securities ORDER BY original_rank`)).rows;
    expect(rows.map((r) => ({ rank: r.original_rank, ticker: r.ticker, name: r.name }))).toEqual(SPEC);
  });

  it('19. original restrictions are enforced and cannot be bypassed by halts, simulation or market-maker opening', async () => {
    const admin = await makeUser(pool, 'admin_y', 'ADMIN');
    const u = await makeUser(pool);
    const cases: [string, string, string | null, bigint | null][] = [
      ['SNIG', 'SECURITY_SUSPENDED', 'SUSPENDED', 1000n],
      ['GANDH', 'SECURITY_UNLISTED', 'UNLISTED', 1000n],
      ['BABU', 'SECURITY_LISTING_HALTED', 'HALTED', 1000n],
      ['MUNCH', 'STATUS_UNVERIFIED', null, null],
      ['STHAN', 'REFERENCE_PRICE_UNVERIFIED', 'ACTIVE', null],
    ];
    for (const [t, reason, status, ref] of cases) {
      await pool.query(`UPDATE securities SET status = $2::security_status, status_source = CASE WHEN $2::text IS NULL THEN NULL ELSE 'VERIFIED_IMPORT'::security_data_source END, reference_price_cents = $3, reference_price_source = CASE WHEN $3::bigint IS NULL THEN NULL ELSE 'VERIFIED_IMPORT'::security_data_source END WHERE ticker = $1`, [t, status, ref]);
      expect((await place(pool, limit(u, t, 'BUY', 1n, 100n))).order.rejectReason).toBe(reason);
      await haltSymbol(pool, { adminId: admin }, t, 'halt');
      await resumeSymbol(pool, { adminId: admin }, t, 'resume');
      expect((await place(pool, limit(u, t, 'BUY', 1n, 100n))).order.rejectReason).toBe(reason);
      await upsertMarketMakerConfig(pool, { adminId: admin }, t, { inventoryShares: 10, askLevels: [{ offsetBps: 0, quantity: 10 }], bidLevels: [], enabled: true, note: 'verification' });
      await expect(openLiquidity(pool, { adminId: admin }, t)).rejects.toMatchObject({ code: 'NOT_TRADABLE' });
    }
    expect((await pool.query(`SELECT COUNT(*)::int n FROM trades`)).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT COUNT(*)::int n FROM security_issuance`)).rows[0].n).toBe(0);
  });

  it('20. market-maker trades follow normal accounting and share conservation', async () => {
    const admin = await makeUser(pool, 'admin_z', 'ADMIN');
    await upsertMarketMakerConfig(pool, { adminId: admin }, T, {
      inventoryShares: 100,
      askLevels: [{ offsetBps: 0, quantity: 10 }, { offsetBps: 2000, quantity: 90 }],
      bidLevels: [{ offsetBps: -2000, quantity: 10 }],
      enabled: true,
      note: 'verification fixture',
    });
    const opened = await openLiquidity(pool, { adminId: admin }, T);
    expect(opened.issuedShares).toBe(100);
    expect(await lastPrice()).toBeNull(); // quoting is not trading
    await expect(openLiquidity(pool, { adminId: admin }, T)).rejects.toMatchObject({ code: 'ALREADY_OPENED' });
    const mm = (await getMarketMakerId(pool))!;
    const mmCash0 = (await cashOf(pool, mm)).cash;
    expect(await holdingOf(pool, mm, T)).toEqual({ qty: 100n, reserved: 100n });

    const a = await makeUser(pool);
    const r = await place(pool, market(a, T, 'BUY', 10n, 10_000n));
    expect(r.fills).toEqual([expect.objectContaining({ priceCents: 1000, quantity: 10 })]);
    expect(await cashOf(pool, mm)).toEqual({ cash: mmCash0 + 10_000n, reserved: 10n * 800n });
    expect(await holdingOf(pool, mm, T)).toEqual({ qty: 90n, reserved: 90n });
    // MM cannot oversell: its remaining asks already reserve all 90 shares.
    const extra = await place(pool, limit(mm, T, 'SELL', 1n, 5000n));
    expect(extra.order.rejectReason).toBe('INSUFFICIENT_SHARES');
    // Sell back into the MM bid at 800.
    const sb = await place(pool, market(a, T, 'SELL', 4n));
    expect(sb.fills).toEqual([expect.objectContaining({ priceCents: 800, quantity: 4 })]);
    // Supply conservation: issued shares == shares held by everyone.
    const issued = (await pool.query(`SELECT SUM(quantity)::bigint s FROM security_issuance WHERE ticker = $1`, [T])).rows[0].s;
    const held = (await pool.query(`SELECT SUM(quantity)::bigint s FROM holdings WHERE ticker = $1`, [T])).rows[0].s;
    expect([issued, held]).toEqual([100n, 100n]);
    // Cash conservation including the market maker.
    const total = (await pool.query(`SELECT SUM(cash_cents)::bigint s FROM cash_accounts`)).rows[0].s;
    const granted = (await pool.query(`SELECT SUM(amount_cents)::bigint s FROM cash_ledger WHERE reason <> 'TRADE_BUY' AND reason <> 'TRADE_SELL'`)).rows[0].s;
    expect(total).toBe(granted);
    await expectIntegrity(pool);
  });
});

/* ---------------------------- Reference model ---------------------------- */

interface MOrder {
  id: number;
  user: number;
  side: 'BUY' | 'SELL';
  price: bigint;
  remaining: bigint;
  seq: number;
}
interface MAccount {
  cash: bigint;
  reserved: bigint;
  qty: bigint;
  rqty: bigint;
}
type MResult = { status: string; fills: [number, number][] };

/** Straightforward specification of the documented rules, written independently of the engine. */
class ReferenceBook {
  orders: MOrder[] = [];
  seq = 0;
  constructor(public acct: MAccount[]) {}

  place(user: number, side: 'BUY' | 'SELL', type: 'LIMIT' | 'MARKET', qty: bigint, price: bigint | null, budget: bigint | null): MResult & { restingId?: number } {
    const a = this.acct[user]!;
    if (side === 'BUY') {
      const need = type === 'LIMIT' ? qty * price! : budget!;
      if (a.cash - a.reserved < need) return { status: 'REJECTED', fills: [] };
    } else if (a.qty - a.rqty < qty) return { status: 'REJECTED', fills: [] };

    const opp = this.orders
      .filter((o) => o.side !== side && (price === null || (side === 'BUY' ? o.price <= price : o.price >= price)))
      .sort((x, y) => (x.price === y.price ? x.seq - y.seq : side === 'BUY' ? (x.price < y.price ? -1 : 1) : x.price > y.price ? -1 : 1));
    let left = qty;
    let money = budget;
    let stp = false;
    const fills: [number, number][] = [];
    for (const m of opp) {
      if (m.user === user) {
        stp = true;
        break;
      }
      let q = m.remaining < left ? m.remaining : left;
      let bound = false;
      if (money !== null) {
        const afford = money / m.price;
        if (afford < q) {
          q = afford;
          bound = true;
        }
        if (q === 0n) break;
        money -= q * m.price;
      }
      const n = q * m.price;
      const buyer = side === 'BUY' ? a : this.acct[m.user]!;
      const seller = side === 'BUY' ? this.acct[m.user]! : a;
      buyer.cash -= n;
      buyer.qty += q;
      seller.cash += n;
      seller.qty -= q;
      if (side === 'BUY') seller.rqty -= q;
      else buyer.reserved -= n;
      m.remaining -= q;
      left -= q;
      fills.push([Number(m.price), Number(q)]);
      if (left === 0n || bound) break;
    }
    this.orders = this.orders.filter((o) => o.remaining > 0n);
    if (left === 0n) return { status: 'FILLED', fills };
    if (type === 'MARKET' || stp) return { status: 'CANCELLED', fills };
    const o: MOrder = { id: ++this.seq, user, side, price: price!, remaining: left, seq: this.seq };
    this.orders.push(o);
    if (side === 'BUY') a.reserved += left * price!;
    else a.rqty += left;
    return { status: fills.length ? 'PARTIALLY_FILLED' : 'OPEN', fills, restingId: o.id };
  }

  cancel(id: number): boolean {
    const o = this.orders.find((x) => x.id === id);
    if (!o) return false;
    const a = this.acct[o.user]!;
    if (o.side === 'BUY') a.reserved -= o.remaining * o.price;
    else a.rqty -= o.remaining;
    this.orders = this.orders.filter((x) => x !== o);
    return true;
  }
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('property test: engine == reference model (randomized, seeded)', () => {
  for (const seed of [1, 7, 42, 2026, 90210]) {
    it(`seed ${seed}: 250 random orders and cancels match the model step by step, with conservation`, async () => {
      const USERS = 5;
      const START_SHARES = 60n;
      const ids: string[] = [];
      for (let i = 0; i < USERS; i++) {
        ids.push(await makeUser(pool));
        await grantShares(pool, T, ids[i]!, START_SHARES);
      }
      const model = new ReferenceBook(Array.from({ length: USERS }, () => ({ cash: STARTING_CASH, reserved: 0n, qty: START_SHARES, rqty: 0n })));
      const idMap = new Map<number, string>(); // model order id -> engine order id
      const rand = rng(seed);
      for (let step = 0; step < 250; step++) {
        const u = Math.floor(rand() * USERS);
        const roll = rand();
        if (roll < 0.12 && model.orders.length > 0) {
          const target = model.orders[Math.floor(rand() * model.orders.length)]!;
          // Only owners cancel; pick that order's owner.
          const engineId = idMap.get(target.id)!;
          const v = await cancelOrder(pool, { orderId: engineId, actorUserId: ids[target.user]! });
          expect(v.status).toBe('CANCELLED');
          expect(model.cancel(target.id)).toBe(true);
          continue;
        }
        const side = rand() < 0.5 ? 'BUY' : 'SELL';
        const qty = BigInt(1 + Math.floor(rand() * 15));
        let expected: ReturnType<ReferenceBook['place']>;
        let res;
        if (roll < 0.8) {
          // Prices clustered around $10 so books cross often; occasional out-of-budget sizes.
          const price = BigInt(950 + Math.floor(rand() * 100)) * (rand() < 0.03 ? 100n : 1n);
          expected = model.place(u, side, 'LIMIT', qty, price, null);
          res = await placeOrder(pool, limit(ids[u]!, T, side, qty, price));
        } else {
          const budget = side === 'BUY' ? BigInt(500 + Math.floor(rand() * 20_000)) : null;
          expected = model.place(u, side, 'MARKET', qty, null, budget);
          res = await placeOrder(pool, market(ids[u]!, T, side, qty, budget ?? undefined));
        }
        expect({ step, status: res.body.order.status, fills: res.body.fills.map((f) => [f.priceCents, f.quantity]) }).toEqual({
          step,
          status: expected.status,
          fills: expected.fills,
        });
        if (expected.restingId) idMap.set(expected.restingId, res.body.order.id);
      }
      for (let i = 0; i < USERS; i++) {
        const m = model.acct[i]!;
        expect({ i, ...(await cashOf(pool, ids[i]!)) }).toEqual({ i, cash: m.cash, reserved: m.reserved });
        expect({ i, ...(await holdingOf(pool, ids[i]!, T)) }).toEqual({ i, qty: m.qty, reserved: m.rqty });
      }
      const open = (await pool.query(`SELECT COUNT(*)::int n FROM orders WHERE status IN ('OPEN','PARTIALLY_FILLED')`)).rows[0].n;
      expect(open).toBe(model.orders.length);
      const totalCash = model.acct.reduce((s, a) => s + a.cash, 0n);
      expect(totalCash).toBe(STARTING_CASH * BigInt(USERS));
      await expectIntegrity(pool);
    });
  }
});
