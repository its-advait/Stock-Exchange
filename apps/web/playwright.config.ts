import crypto from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

// Throwaway credentials for the throwaway e2e database; generated per run, never stored.
process.env.E2E_ADMIN_PASSWORD ??= `e2e-${crypto.randomBytes(12).toString('hex')}`;
const PORT = Number(process.env.E2E_PORT ?? 4100);
// E2E_BASE_URL runs the same specs against an already-running deployment instead.
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: 'e2e-results/results.json' }]],
  outputDir: 'e2e-results/artifacts',
  use: {
    baseURL: external ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /fixture\.setup\.ts/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'], testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, dependencies: ['desktop'], testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: external
    ? undefined
    : {
        command: '../../node_modules/.bin/tsx e2e/stack.ts',
        url: `http://localhost:${PORT}/ready`,
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
        gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
        env: { E2E_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD, E2E_PORT: String(PORT) },
      },
});
