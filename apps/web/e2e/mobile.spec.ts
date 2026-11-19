/** Phone-sized checks: no horizontal overflow, mobile navigation, and a full trade from a phone. */
import { expect, test } from '@playwright/test';
import { placeViaTicket, portfolio, register, TICKER, uname } from './helpers';

test('mobile layout: pages fit the screen and a trade can be placed from a phone', async ({ page }) => {
  await register(page, uname('mobile'));
  for (const path of ['/dashboard', '/markets', `/stocks/${TICKER}`, '/portfolio', '/leaderboard', '/news']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(0);
  }
  await expect(page.getByRole('link', { name: 'Portfolio' }).last()).toBeVisible(); // bottom tab bar
  await page.goto(`/stocks/${TICKER}`);
  const toast = await placeViaTicket(page, { side: 'Buy', kind: 'Limit', qty: 1, limit: '20.00' });
  expect(toast).toContain('resting');
  expect((await portfolio(page)).reservedCashCents).toBe(2000);
});
