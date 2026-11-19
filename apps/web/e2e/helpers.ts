import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const TICKER = process.env.E2E_TICKER ?? 'SHVM';
export const PASSWORD = 'e2e-trader-password-123';

/** Unique, valid usernames per run (3-32 chars, letters/numbers/underscore). */
const run = Date.now().toString(36).slice(-6);
export const uname = (base: string) => `${base}_${run}`.slice(0, 32);

export async function register(page: Page, username: string) {
  await page.goto('/register');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' }).or(page.getByRole('link', { name: /sign in/i })).first()).toBeVisible();
  const me = await page.request.get('/api/auth/me');
  expect(me.status()).toBe(401);
}

export interface TicketOrder {
  side: 'Buy' | 'Sell';
  kind: 'Market' | 'Limit';
  qty: number;
  limit?: string;
}

/** Drive the real trade ticket: fill, review, confirm. Returns the exchange's toast text. */
export async function placeViaTicket(page: Page, o: TicketOrder): Promise<string> {
  const side = page.getByRole('radiogroup', { name: 'Order side' });
  await side.getByRole('radio', { name: o.side }).click();
  await page.getByRole('radiogroup', { name: 'Order type' }).getByRole('radio', { name: o.kind }).click();
  await page.locator('#qty').fill(String(o.qty));
  if (o.kind === 'Limit') await page.locator('#limit').fill(o.limit!);
  // Mark existing toasts so we read only the one this order produces.
  await page.evaluate(() => document.querySelectorAll('[data-sonner-toast]').forEach((e) => e.setAttribute('data-e2e-seen', '1')));
  const review = page.getByRole('button', { name: `Review ${o.side.toLowerCase()} order` });
  await expect(review).toBeEnabled();
  await review.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: `Place ${o.side.toLowerCase()} order` }).click();
  await expect(dialog).toBeHidden();
  const toast = page.locator('[data-sonner-toast]:not([data-e2e-seen])').first();
  await expect(toast).toBeVisible();
  return (await toast.innerText()).replace(/\s+/g, ' ');
}

export async function api<T>(req: APIRequestContext, path: string): Promise<T> {
  const r = await req.get(path);
  expect(r.ok(), `${path} -> ${r.status()}`).toBeTruthy();
  return (await r.json()) as T;
}

export interface Portfolio {
  cashCents: number;
  reservedCashCents: number;
  availableCashCents: number;
  totalValueCents: number;
  holdings: { ticker: string; quantity: number; reservedQuantity: number; availableQuantity: number }[];
  openOrders: { id: string; side: string; limitPriceCents: number | null; remainingQuantity: number }[];
}

export const portfolio = (page: Page) => api<{ portfolio: Portfolio }>(page.request, '/api/portfolio').then((r) => r.portfolio);
export const holdingQty = (p: Portfolio, t = TICKER) => p.holdings.find((h) => h.ticker === t)?.quantity ?? 0;
