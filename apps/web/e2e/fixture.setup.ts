/**
 * Controlled test fixture, applied ONLY to the throwaway e2e database through the
 * real, audited admin API (no direct database writes, no holdings inserted):
 *   - a clearly labeled SIMULATED $35.00 reference for the test ticker
 *   - designated market-maker liquidity: 10 shares offered at $35.00, the rest at $42.00,
 *     and a 10-share bid at $28.00.
 * It never runs against an external deployment unless E2E_ALLOW_FIXTURE=1.
 */
import { expect, test } from '@playwright/test';
import { TICKER } from './helpers';

test('configure the e2e market fixture through the admin API', async ({ request }) => {
  if (process.env.E2E_BASE_URL && process.env.E2E_ALLOW_FIXTURE !== '1') {
    test.skip(true, 'External deployment: fixture is not applied automatically');
  }
  const login = await request.post('/api/auth/login', {
    data: { username: process.env.E2E_ADMIN_USERNAME ?? 'e2e_admin', password: process.env.E2E_ADMIN_PASSWORD },
  });
  expect(login.status()).toBe(200);

  const sec = await (await request.get(`/api/securities/${TICKER}`)).json();
  if (!sec.security.tradable) {
    const sim = await request.post(`/api/admin/securities/${TICKER}/simulated-reference`, {
      data: {
        referencePriceCents: 3500,
        activate: true,
        note: 'E2E test fixture only (throwaway database)',
        acknowledgement: 'I UNDERSTAND THIS PRICE IS SIMULATED AND NOT ORIGINAL',
      },
    });
    expect(sim.status(), await sim.text()).toBe(200);
  }
  const cfg = await request.put(`/api/admin/market-maker/${TICKER}`, {
    data: {
      inventoryShares: 100,
      askLevels: [
        { offsetBps: 0, quantity: 10 },
        { offsetBps: 2000, quantity: 90 },
      ],
      bidLevels: [{ offsetBps: -2000, quantity: 10 }],
      enabled: true,
      note: 'E2E fixture: designated market-maker inventory',
    },
  });
  expect(cfg.status(), await cfg.text()).toBe(200);
  const open = await request.post(`/api/admin/market-maker/${TICKER}/open`);
  expect([200, 409]).toContain(open.status()); // 409 ALREADY_OPENED on a re-run
  await request.post('/api/auth/logout');
});
