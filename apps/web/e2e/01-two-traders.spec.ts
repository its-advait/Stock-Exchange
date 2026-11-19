/**
 * The required two-account demonstration, driven through the real UI in two
 * isolated browser sessions, with every result confirmed against the API.
 */
import { expect, test } from '@playwright/test';
import { api, holdingQty, login, logout, placeViaTicket, portfolio, register, TICKER, uname } from './helpers';

const START = 1_000_000; // $10,000.00 in cents

test('Trader A and Trader B trade 10 shares at $40 and keep their state across logout/login', async ({ browser }) => {
  const A = uname('trader_a');
  const B = uname('trader_b');
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await test.step('both traders register and receive exactly $10,000', async () => {
    await register(a, A);
    await register(b, B);
    for (const p of [a, b]) {
      const pf = await portfolio(p);
      expect(pf).toMatchObject({ cashCents: START, reservedCashCents: 0, totalValueCents: START, holdings: [] });
      await expect(p.getByText('$10,000.00').first()).toBeVisible();
    }
  });

  let purchaseCost = 0;
  await test.step('Trader A buys 10 shares from the designated market maker through a real trade', async () => {
    const book0 = await api<{ book: { asks: { priceCents: number; quantity: number }[] } }>(a.request, `/api/securities/${TICKER}/book`);
    const bestAsk = book0.book.asks[0]!;
    expect(bestAsk.quantity).toBeGreaterThanOrEqual(10);
    await a.goto(`/stocks/${TICKER}`);
    const toast = await placeViaTicket(a, { side: 'Buy', kind: 'Market', qty: 10 });
    expect(toast).toContain(`Bought 10 ${TICKER}`);
    expect(toast).toContain('confirmed by the exchange');
    const pf = await portfolio(a);
    expect(holdingQty(pf)).toBe(10);
    purchaseCost = START - pf.cashCents;
    expect(purchaseCost).toBe(10 * bestAsk.priceCents);
    const mine = await api<{ trades: { side: string; priceCents: number; quantity: number; ticker: string }[] }>(a.request, '/api/account/trades');
    expect(mine.trades[0]).toMatchObject({ side: 'BUY', ticker: TICKER, quantity: 10, priceCents: bestAsk.priceCents });
  });

  await test.step('Trader A rests a limit sell of 10 at $40.00; Trader B sees it live', async () => {
    await b.goto(`/stocks/${TICKER}`);
    await expect(b.getByRole('heading', { name: TICKER, exact: true })).toBeVisible();
    const toast = await placeViaTicket(a, { side: 'Sell', kind: 'Limit', qty: 10, limit: '40.00' });
    expect(toast).toContain('Limit order resting on the book');
    const pf = await portfolio(a);
    expect(pf.holdings.find((h) => h.ticker === TICKER)).toMatchObject({ quantity: 10, reservedQuantity: 10, availableQuantity: 0 });
    // Real-time: B's open page shows the new $40.00 ask without a reload.
    await expect(b.getByTitle('Use this price for a limit order').filter({ hasText: '$40.00' })).toBeVisible();
  });

  await test.step('Trader B buys 10 at $40.00 and the exchange matches against Trader A', async () => {
    const toast = await placeViaTicket(b, { side: 'Buy', kind: 'Limit', qty: 10, limit: '40.00' });
    expect(toast).toContain(`Bought 10 ${TICKER} @ avg $40.00`);
  });

  await test.step('balances, holdings, trade history, last price, book, portfolios and leaderboard all agree', async () => {
    const pa = await portfolio(a);
    const pb = await portfolio(b);
    expect(pa.cashCents).toBe(START - purchaseCost + 40_000); // A receives $400
    expect(holdingQty(pa)).toBe(0); // A loses 10 shares
    expect(pb.cashCents).toBe(START - 40_000); // B spends $400
    expect(holdingQty(pb)).toBe(10); // B receives 10 shares
    expect([pa.reservedCashCents, pb.reservedCashCents]).toEqual([0, 0]);

    const tape = await api<{ trades: { priceCents: number; quantity: number }[] }>(a.request, `/api/securities/${TICKER}/trades?limit=5`);
    expect(tape.trades[0]).toMatchObject({ priceCents: 4000, quantity: 10 });
    const sec = await api<{ security: { lastPriceCents: number; displayPriceKind: string } }>(a.request, `/api/securities/${TICKER}`);
    expect(sec.security).toMatchObject({ lastPriceCents: 4000, displayPriceKind: 'LAST_TRADE' });
    const book = await api<{ book: { asks: { priceCents: number }[]; bids: { priceCents: number }[] } }>(a.request, `/api/securities/${TICKER}/book`);
    expect(book.book.asks.some((l) => l.priceCents === 4000)).toBe(false);
    expect(book.book.bids.some((l) => l.priceCents === 4000)).toBe(false);

    // Real-time in both sessions: the last price updates without reloading either page.
    await expect(a).toHaveTitle(new RegExp(`${TICKER} \\$40\\.00`));
    await expect(b).toHaveTitle(new RegExp(`${TICKER} \\$40\\.00`));
    await expect(a.getByTitle('Use this price for a limit order').filter({ hasText: '$40.00' })).toHaveCount(0);

    expect(pb.totalValueCents).toBe(START - 40_000 + 10 * 4000);
    expect(pa.totalValueCents).toBe(pa.cashCents);
    const lb = await api<{ entries: { username: string; totalValueCents: number }[] }>(a.request, '/api/leaderboard?limit=200');
    expect(lb.entries.find((e) => e.username === A)?.totalValueCents).toBe(pa.totalValueCents);
    expect(lb.entries.find((e) => e.username === B)?.totalValueCents).toBe(pb.totalValueCents);

    await a.goto('/leaderboard');
    await a.getByRole('tab', { name: 'Full ranking' }).click();
    await expect(a.getByText(A).first()).toBeVisible();
    await expect(a.getByText(B).first()).toBeVisible();

    await a.goto('/portfolio');
    await a.getByRole('tab', { name: 'Executions' }).click();
    await expect(a.getByRole('row').filter({ hasText: '$40.00' }).first()).toBeVisible();
  });

  const before = { a: await portfolio(a), b: await portfolio(b) };

  await test.step('both traders log out and back in; state is unchanged', async () => {
    await logout(a);
    await logout(b);
    await login(a, A);
    await login(b, B);
    const after = { a: await portfolio(a), b: await portfolio(b) };
    for (const k of ['a', 'b'] as const) {
      expect(after[k].cashCents).toBe(before[k].cashCents);
      expect(after[k].holdings).toEqual(before[k].holdings);
      expect(after[k].totalValueCents).toBe(before[k].totalValueCents);
    }
    await b.goto('/portfolio');
    await expect(b.getByRole('link', { name: TICKER }).first()).toBeVisible();
  });

  await ctxA.close();
  await ctxB.close();
});
