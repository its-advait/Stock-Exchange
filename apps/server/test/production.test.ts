/** Production hosting and hardening: same-origin SPA, CSP, cross-site rejection, config guards. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertServable, loadConfig } from '../src/config.js';
import { createServer, type RunningServer } from '../src/server.js';
import { databaseUrl, newPool, resetDatabase, testConfig } from './helpers.js';

const THEME = `try{if(localStorage.getItem('aez-theme')==='light')document.documentElement.classList.add('light')}catch(e){}`;
let dist: string;
let srv: RunningServer;

beforeAll(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'aez-dist-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(
    path.join(dist, 'index.html'),
    `<!doctype html><html><head><script>${THEME}</script><script type="module" crossorigin src="/assets/app.js"></script></head><body><div id="root"></div></body></html>`,
  );
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  srv = await createServer(testConfig({ WEB_DIST_DIR: dist }), newPool());
  await resetDatabase(srv.pool);
});
afterAll(async () => {
  await srv.close();
  fs.rmSync(dist, { recursive: true, force: true });
});

describe('same-origin SPA hosting', () => {
  it('serves index.html for client routes with a strict CSP that allows only the inline theme script by hash', async () => {
    for (const url of ['/', '/stocks/SHVM', '/portfolio?x=1']) {
      const r = await srv.app.inject({ method: 'GET', url });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toContain('text/html');
      expect(r.body).toContain('<div id="root">');
      const csp = String(r.headers['content-security-policy']);
      const hash = crypto.createHash('sha256').update(THEME).digest('base64');
      expect(csp).toContain(`script-src 'self' 'sha256-${hash}'`);
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain("'unsafe-eval'");
    }
  });

  it('serves hashed assets as immutable and keeps API 404s as JSON', async () => {
    const a = await srv.app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(a.statusCode).toBe(200);
    expect(a.headers['cache-control']).toContain('immutable');
    expect((await srv.app.inject({ method: 'GET', url: '/favicon.svg' })).statusCode).toBe(200);
    const api = await srv.app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect((await srv.app.inject({ method: 'GET', url: '/assets/missing.js' })).statusCode).toBe(404);
    expect((await srv.app.inject({ method: 'GET', url: '/../package.json' })).body).not.toContain('"name"');
    expect((await srv.app.inject({ method: 'GET', url: '/ready' })).json()).toEqual({ ok: true });
  });
});

describe('cross-site protections', () => {
  it('rejects state-changing requests flagged cross-site even without an Origin header', async () => {
    const r = await srv.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'sec-fetch-site': 'cross-site' },
      payload: { username: 'nobody', password: 'whatever-123' },
    });
    expect(r.statusCode).toBe(403);
    const bad = await srv.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin: 'https://evil.example' } });
    expect(bad.statusCode).toBe(403);
    const same = await srv.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { 'sec-fetch-site': 'same-origin' } });
    expect(same.statusCode).toBe(204);
  });
});

describe('production configuration guards', () => {
  const base = { NODE_ENV: 'production', DATABASE_URL: databaseUrl() };
  it('requires an explicit origin in production, or derives it from Railway', () => {
    expect(loadConfig({ ...base }).WEB_ORIGINS).toEqual([]); // scripts (migrate/seed) may run without it
    expect(() => assertServable(loadConfig({ ...base }))).toThrow(/WEB_ORIGINS/);
    expect(() => loadConfig({ ...base, WEB_ORIGINS: 'http://aez.example' })).toThrow(/https/);
    expect(loadConfig({ ...base, RAILWAY_PUBLIC_DOMAIN: 'aez.up.railway.app' }).WEB_ORIGINS).toEqual(['https://aez.up.railway.app']);
    expect(loadConfig({ ...base, WEB_ORIGINS: 'https://a.example/, https://b.example' }).WEB_ORIGINS).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });
  it('refuses insecure cookies or non-standard starting cash in production', () => {
    expect(loadConfig({ ...base, WEB_ORIGINS: 'https://a.example' }).COOKIE_SECURE).toBe(true);
    expect(() => loadConfig({ ...base, WEB_ORIGINS: 'https://a.example', COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(() => loadConfig({ ...base, WEB_ORIGINS: 'https://a.example', STARTING_CASH_CENTS: '5' })).toThrow(/STARTING_CASH/);
  });
});
