/** Rejected orders, cancellation and partial fills through the real UI and API. */
import { expect, test } from '@playwright/test';
import { holdingQty, placeViaTicket, portfolio, register, TICKER, uname } from './helpers';

test('rejections: the ticket blocks unaffordable orders, and server-side rejections are recorded and shown', async ({ page }) => {
  await register(page, uname('rej'));
  await page.goto(`/stocks/${TICKER}`);
  const side = page.getByRole('radiogroup', { name: 'Order side' });

  // Client-side guard (no request is sent).
  await side.getByRole('radio', { name: 'Buy' }).click();
  await page.getByRole('radiogroup', { name: 'Order type' }).getByRole('radio', { name: 'Limit' }).click();
  await page.locator('#qty').fill('1000');
  await page.locator('#limit').fill('40.00');
  await expect(page.getByText(/This needs \$40,000\.00 but your buying power is \$10,000\.00/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review buy order' })).toBeDisabled();
  await side.getByRole('radio', { name: 'Sell' }).click();
  await page.locator('#qty').fill('5');
  await expect(page.getByText(/no available .* shares to sell\. Short selling is disabled/)).toBeVisible();

  // Server-side enforcement for anything that bypasses the UI.
  const r = await page.request.post('/api/orders', {
    headers: { 'Idempotency-Key': `e2e-reject-${Date.now()}` },
    data: { ticker: TICKER, side: 'SELL', type: 'LIMIT', quantity: 5, limitPriceCents: 4000 },
  });
  expect(r.status()).toBe(422);
  expect((await r.json()).order).toMatchObject({ status: 'REJECTED', rejectReason: 'INSUFFICIENT_SHARES' });
  const noKey = await page.request.post('/api/orders', { data: { ticker: TICKER, side: 'BUY', type: 'LIMIT', quantity: 1, limitPriceCents: 100 } });
  expect(noKey.status()).toBe(400);
  const pf = await portfolio(page);
  expect([pf.cashCents, pf.reservedCashCents, holdingQty(pf)]).toEqual([1_000_000, 0, 0]);

  await page.goto('/portfolio');
  await page.getByRole('tab', { name: 'All orders' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Rejected' }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText('insufficient shares');
});

test('cancellation releases the reserved cash, confirmed in the UI and the API', async ({ page }) => {
  await register(page, uname('cancel'));
  await page.goto(`/stocks/${TICKER}`);
  const toast = await placeViaTicket(page, { side: 'Buy', kind: 'Limit', qty: 5, limit: '30.00' });
  expect(toast).toContain('Limit order resting on the book');
  let pf = await portfolio(page);
  expect([pf.cashCents, pf.reservedCashCents, pf.availableCashCents]).toEqual([1_000_000, 15_000, 985_000]);

  await page.goto('/portfolio');
  const row = page.getByRole('row').filter({ hasText: '$30.00' }).first();
  await row.getByRole('button', { name: 'Cancel' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('$150.00 of reserved cash will be released');
  await dialog.getByRole('button', { name: 'Cancel order' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await portfolio(page)).reservedCashCents).toBe(0);
  pf = await portfolio(page);
  expect([pf.cashCents, pf.availableCashCents, pf.openOrders.length]).toEqual([1_000_000, 1_000_000, 0]);
  await page.getByRole('tab', { name: 'All orders' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Cancelled' }).first()).toBeVisible();
});

test('partial fills: resting and incoming orders keep exact remaining quantities and reservations', async ({ browser }) => {
  const dCtx = await browser.newContext();
  const eCtx = await browser.newContext();
  const d = await dCtx.newPage();
  const e = await eCtx.newPage();
  await register(d, uname('part_d'));
  await register(e, uname('part_e'));

  // D acquires 6 shares from the market maker's remaining inventory.
  await d.goto(`/stocks/${TICKER}`);
  expect(await placeViaTicket(d, { side: 'Buy', kind: 'Market', qty: 6 })).toContain(`Bought 6 ${TICKER}`);
  expect(await placeViaTicket(d, { side: 'Sell', kind: 'Limit', qty: 6, limit: '41.00' })).toContain('resting');

  // E takes 4 of D's 6: D's resting order is partially filled.
  await e.goto(`/stocks/${TICKER}`);
  expect(await placeViaTicket(e, { side: 'Buy', kind: 'Limit', qty: 4, limit: '41.00' })).toContain(`Bought 4 ${TICKER} @ avg $41.00`);
  let pd = await portfolio(d);
  expect(pd.holdings.find((h) => h.ticker === TICKER)).toMatchObject({ quantity: 2, reservedQuantity: 2 });
  expect(pd.openOrders).toEqual([expect.objectContaining({ side: 'SELL', limitPriceCents: 4100, remainingQuantity: 2 })]);
  await d.goto('/portfolio');
  const dRow = d.getByRole('row').filter({ hasText: 'Partially filled' }).filter({ hasText: '$41.00' }).first();
  await expect(dRow).toContainText('4 / 6');
  await expect(dRow).toContainText('Partially filled');

  // E's incoming order for 10 takes D's last 2 and rests the other 8 at $41.00 (below the market maker's $42.00 asks).
  const t = await placeViaTicket(e, { side: 'Buy', kind: 'Limit', qty: 10, limit: '41.00' });
  expect(t).toContain(`Partially filled: 2/10 ${TICKER}`);
  const pe = await portfolio(e);
  expect(holdingQty(pe)).toBe(6);
  expect(pe.reservedCashCents).toBe(8 * 4100);
  expect(pe.cashCents).toBe(1_000_000 - 6 * 4100);
  pd = await portfolio(d);
  expect([holdingQty(pd), pd.openOrders.length]).toEqual([0, 0]);
  await dCtx.close();
  await eCtx.close();
});
