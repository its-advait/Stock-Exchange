/**
 * Import + validation of the ORIGINAL securities dataset (reference prices,
 * listing statuses, restrictions, descriptions). See docs/DATA_IMPORT.md.
 */
import crypto from 'node:crypto';
import { LIMITS, STOCK_UNIVERSE, parseDollarsToCents } from '@aez/shared';
import type { Pool } from '../db/pool.js';
import { withTx } from '../db/tx.js';
import { audit } from '../lib/audit.js';

export const IMPORT_COLUMNS = [
  'ticker',
  'name',
  'original_rank',
  'reference_price',
  'status',
  'trading_restriction',
  'description',
  'news',
  'background',
  'image_url',
] as const;
const REQUIRED_COLUMNS = ['ticker', 'name', 'original_rank', 'reference_price', 'status'];
const STATUSES = new Set(['ACTIVE', 'HALTED', 'SUSPENDED', 'UNLISTED']);

export interface ImportRecord {
  ticker: string;
  name: string;
  originalRank: number;
  referencePriceCents: bigint | null;
  status: 'ACTIVE' | 'HALTED' | 'SUSPENDED' | 'UNLISTED' | null;
  tradingRestriction: string | null;
  description: string | null;
  news: string | null;
  background: string | null;
  imageUrl: string | null;
}

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  records: ImportRecord[];
  missingTickers: string[];
  unexpectedTickers: string[];
  duplicateTickers: string[];
}

/** RFC 4180-ish CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      i++;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (quoted) throw new Error('Unterminated quoted field in CSV');
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export function validateDataset(csvText: string, opts: { requireComplete: boolean }): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const records: ImportRecord[] = [];
  let rows: string[][];
  try {
    rows = parseCsv(csvText);
  } catch (e) {
    return { ok: false, errors: [(e as Error).message], warnings, records, missingTickers: [], unexpectedTickers: [], duplicateTickers: [] };
  }
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  for (const col of REQUIRED_COLUMNS) if (!header.includes(col)) errors.push(`Missing required column: ${col}`);
  for (const col of header) if (!(IMPORT_COLUMNS as readonly string[]).includes(col)) errors.push(`Unknown column: ${col}`);
  if (errors.length) return { ok: false, errors, warnings, records, missingTickers: [], unexpectedTickers: [], duplicateTickers: [] };

  const idx = (c: string) => header.indexOf(c);
  const get = (r: string[], c: string) => {
    const k = idx(c);
    if (k < 0) return null;
    const v = (r[k] ?? '').trim();
    return v === '' ? null : v;
  };

  const canon = new Map(STOCK_UNIVERSE.map((s) => [s.ticker, s]));
  const seen = new Map<string, number>();
  rows.forEach((r, n) => {
    const line = n + 2;
    if (r.length !== header.length) errors.push(`Line ${line}: expected ${header.length} fields, found ${r.length}`);
    const ticker = (get(r, 'ticker') ?? '').toUpperCase();
    seen.set(ticker, (seen.get(ticker) ?? 0) + 1);
    const c = canon.get(ticker);
    if (!c) {
      errors.push(`Line ${line}: ticker "${ticker}" is not one of the 45 canonical tickers`);
      return;
    }
    const name = get(r, 'name');
    if (name !== c.name) errors.push(`Line ${line} (${ticker}): name "${name}" does not exactly match canonical "${c.name}"`);
    const rank = Number(get(r, 'original_rank'));
    if (!Number.isInteger(rank) || rank !== c.rank)
      errors.push(`Line ${line} (${ticker}): original_rank ${get(r, 'original_rank')} does not match canonical ${c.rank}`);

    const priceStr = get(r, 'reference_price');
    let price: bigint | null = null;
    if (priceStr === null) {
      (opts.requireComplete ? errors : warnings).push(`Line ${line} (${ticker}): reference_price missing; security stays non-tradable`);
    } else {
      price = parseDollarsToCents(priceStr);
      if (price === null || price <= 0n || price > BigInt(LIMITS.MAX_PRICE_CENTS))
        errors.push(`Line ${line} (${ticker}): invalid reference_price "${priceStr}" (positive dollars, max 2 decimals)`);
    }
    const statusStr = get(r, 'status')?.toUpperCase() ?? null;
    if (statusStr === null) {
      (opts.requireComplete ? errors : warnings).push(`Line ${line} (${ticker}): status missing; security stays non-tradable`);
    } else if (!STATUSES.has(statusStr)) {
      errors.push(`Line ${line} (${ticker}): invalid status "${statusStr}" (ACTIVE|HALTED|SUSPENDED|UNLISTED)`);
    }
    const imageUrl = get(r, 'image_url');
    if (imageUrl !== null && !/^https:\/\/[^\s"'<>]+$/.test(imageUrl)) errors.push(`Line ${line} (${ticker}): image_url must be an https URL`);

    records.push({
      ticker,
      name: c.name,
      originalRank: c.rank,
      referencePriceCents: price,
      status: statusStr as ImportRecord['status'],
      tradingRestriction: get(r, 'trading_restriction'),
      description: get(r, 'description'),
      news: get(r, 'news'),
      background: get(r, 'background'),
      imageUrl,
    });
  });

  const duplicateTickers = [...seen].filter(([, n]) => n > 1).map(([t]) => t);
  const missingTickers = STOCK_UNIVERSE.map((s) => s.ticker).filter((t) => !seen.has(t));
  const unexpectedTickers = [...seen.keys()].filter((t) => !canon.has(t));
  for (const t of duplicateTickers) errors.push(`Duplicate ticker: ${t}`);
  if (missingTickers.length) errors.push(`Missing tickers (${missingTickers.length}): ${missingTickers.join(', ')}`);
  if (rows.length !== STOCK_UNIVERSE.length)
    errors.push(`Expected exactly ${STOCK_UNIVERSE.length} data rows, found ${rows.length}`);
  return { ok: errors.length === 0, errors, warnings, records, missingTickers, unexpectedTickers, duplicateTickers };
}

/**
 * Apply a validated dataset atomically. Refuses to change the reference price of
 * a security that has already traded (would rewrite history).
 */
export async function applyDataset(
  pool: Pool,
  report: ValidationReport,
  meta: { verifiedBy: string; sourceReference: string; csvText: string },
): Promise<{ updated: number }> {
  if (!report.ok) throw new Error('Refusing to apply an invalid dataset');
  const fileSha256 = crypto.createHash('sha256').update(meta.csvText).digest('hex');
  return withTx(pool, async (c) => {
    await c.query(`SELECT 1 FROM market_state WHERE id = 1 FOR UPDATE`);
    let updated = 0;
    for (const r of report.records) {
      const cur = await c.query<{ reference_price_cents: bigint | null; traded: boolean }>(
        `SELECT reference_price_cents, EXISTS (SELECT 1 FROM trades t WHERE t.ticker = s.ticker) AS traded
           FROM securities s WHERE ticker = $1 FOR UPDATE`,
        [r.ticker],
      );
      const row = cur.rows[0]!;
      if (row.traded && r.referencePriceCents !== null && row.reference_price_cents !== r.referencePriceCents) {
        throw new Error(`${r.ticker} has already traded; refusing to change its reference price (reset the simulation first)`);
      }
      await c.query(
        `UPDATE securities SET
            reference_price_cents = COALESCE($2, reference_price_cents),
            reference_price_source = CASE WHEN $2::bigint IS NULL THEN reference_price_source ELSE 'VERIFIED_IMPORT' END,
            reference_verified_at = CASE WHEN $2::bigint IS NULL THEN reference_verified_at ELSE now() END,
            reference_verified_by = CASE WHEN $2::bigint IS NULL THEN reference_verified_by ELSE $9 END,
            verification_source_ref = CASE WHEN $2::bigint IS NULL THEN verification_source_ref ELSE $10 END,
            status = COALESCE($3::security_status, status),
            status_source = CASE WHEN $3::text IS NULL THEN status_source ELSE 'VERIFIED_IMPORT' END,
            status_updated_at = CASE WHEN $3::text IS NULL THEN status_updated_at ELSE now() END,
            trading_restriction = COALESCE($4, trading_restriction),
            description = COALESCE($5, description),
            news = COALESCE($6, news),
            background = COALESCE($7, background),
            image_url = COALESCE($8, image_url),
            updated_at = now()
          WHERE ticker = $1`,
        [
          r.ticker,
          r.referencePriceCents,
          r.status,
          r.tradingRestriction,
          r.description,
          r.news,
          r.background,
          r.imageUrl,
          meta.verifiedBy,
          `${meta.sourceReference} (sha256:${fileSha256})`,
        ],
      );
      updated++;
    }
    await audit(c, {
      actorUserId: null,
      action: 'VERIFIED_DATASET_IMPORT',
      targetType: 'securities',
      details: { verifiedBy: meta.verifiedBy, sourceReference: meta.sourceReference, fileSha256, rows: updated, warnings: report.warnings },
    });
    return { updated };
  });
}
