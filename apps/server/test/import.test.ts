import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STOCK_UNIVERSE } from '@aez/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { applyDataset, parseCsv, validateDataset } from '../src/services/importDataset.js';
import { getSecurity, listSecurities } from '../src/services/market.js';
import { newPool, resetDatabase } from './helpers.js';

const pool = newPool();
beforeEach(() => resetDatabase(pool));
afterAll(() => pool.end());

const HEADER = 'ticker,name,original_rank,reference_price,status,trading_restriction,description,news,background,image_url';

/** Deterministic FIXTURE values (obviously synthetic: rank-based); not the original dataset. */
function fixtureCsv(mutate?: (rows: string[][]) => void): string {
  const rows = STOCK_UNIVERSE.map((s) => [s.ticker, s.name, String(s.rank), `${s.rank}.00`, 'ACTIVE', '', '', '', '', '']);
  mutate?.(rows);
  return [HEADER, ...rows.map((r) => r.map((f) => (/[",\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f)).join(','))].join('\n');
}

describe('original dataset import', () => {
  it('the shipped template has exactly the 45 canonical tickers and names', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const tpl = fs.readFileSync(path.resolve(here, '../../../data/import/original-dataset.template.csv'), 'utf8');
    const report = validateDataset(tpl, { requireComplete: false });
    expect(report.errors).toEqual([]);
    expect(report.missingTickers).toEqual([]);
    expect(report.records.every((r) => r.referencePriceCents === null && r.status === null)).toBe(true);
    expect(validateDataset(tpl, { requireComplete: true }).ok).toBe(false);
  });

  it('accepts a complete exact dataset and applies it as VERIFIED', async () => {
    const csv = fixtureCsv((rows) => {
      rows[0]![4] = 'SUSPENDED';
      rows[1]![3] = '12.5';
      rows[1]![6] = 'Has a "quoted", comma description';
    });
    const report = validateDataset(csv, { requireComplete: true });
    expect(report.errors).toEqual([]);
    expect(report.records[1]!.referencePriceCents).toBe(1250n);
    await applyDataset(pool, report, { verifiedBy: 'tester', sourceReference: 'unit test fixture', csvText: csv });
    const jink = await getSecurity(pool, 'JINK');
    expect(jink).toMatchObject({ listingStatus: 'SUSPENDED', tradable: false, referencePriceKind: 'VERIFIED' });
    const tman = await getSecurity(pool, 'TMAN');
    expect(tman).toMatchObject({ tradable: true, referencePriceCents: 1250, description: 'Has a "quoted", comma description' });
    expect((await listSecurities(pool)).filter((s) => s.tradable)).toHaveLength(44);
  });

  it('reports missing, unexpected, duplicate tickers and name/rank mismatches exactly', () => {
    const csv = fixtureCsv((rows) => {
      rows.pop(); // drop JTOM
      rows[0]![0] = 'ZZZZ';
      rows[2]![1] = 'Andy Li';
      rows[3]![2] = '99';
      rows.push([...rows[4]!]);
    });
    const r = validateDataset(csv, { requireComplete: true });
    expect(r.ok).toBe(false);
    expect(r.missingTickers.sort()).toEqual(['JINK', 'JTOM']);
    expect(r.unexpectedTickers).toEqual(['ZZZZ']);
    expect(r.duplicateTickers).toEqual(['NSJP']);
    expect(r.errors.some((e) => e.includes('ALI') && e.includes('Andy Li'))).toBe(true);
    expect(r.errors.some((e) => e.includes('AMET') && e.includes('original_rank'))).toBe(true);
  });

  it('rejects malformed prices and statuses without floating point', () => {
    for (const bad of ['-1', '0', '1.234', 'abc', '1e3', '10.']) {
      const r = validateDataset(fixtureCsv((rows) => (rows[0]![3] = bad)), { requireComplete: true });
      expect(r.ok, bad).toBe(false);
    }
    expect(validateDataset(fixtureCsv((rows) => (rows[0]![4] = 'OPEN')), { requireComplete: true }).ok).toBe(false);
    expect(validateDataset(fixtureCsv((rows) => (rows[0]![9] = 'javascript:alert(1)')), { requireComplete: true }).ok).toBe(false);
    expect(parseCsv('a,b\n"x,1","y""z"\n')).toEqual([
      ['a', 'b'],
      ['x,1', 'y"z'],
    ]);
  });
});
