/**
 * Validate (and optionally apply) the ORIGINAL securities dataset.
 *
 *   npm run db:import -- --file data/import/original-dataset.csv                       # dry run (default)
 *   npm run db:import -- --file <csv> --apply --verified-by "Name" --source "Doc ref"  # apply
 *   add --require-complete to fail if any price/status is blank
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { applyDataset, validateDataset } from '../services/importDataset.js';

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    apply: { type: 'boolean', default: false },
    'verified-by': { type: 'string' },
    source: { type: 'string' },
    'require-complete': { type: 'boolean', default: false },
  },
});
if (!values.file) {
  console.error('Usage: --file <csv> [--apply --verified-by <name> --source <reference>] [--require-complete]');
  process.exit(2);
}
const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), values.file);
const csv = fs.readFileSync(file, 'utf8');
const report = validateDataset(csv, { requireComplete: values['require-complete'] });

console.log(`Validated ${report.records.length} rows from ${file}`);
for (const w of report.warnings) console.log(`  WARN  ${w}`);
for (const e of report.errors) console.log(`  ERROR ${e}`);
console.log(
  `Ticker comparison vs canonical 45: missing=[${report.missingTickers.join(',')}] unexpected=[${report.unexpectedTickers.join(',')}] duplicates=[${report.duplicateTickers.join(',')}]`,
);
if (!report.ok) {
  console.error('Validation FAILED. Nothing was written.');
  process.exit(1);
}
const tradable = report.records.filter((r) => r.status === 'ACTIVE' && r.referencePriceCents !== null).length;
console.log(`Validation OK. ${tradable} of 45 securities would become tradable (ACTIVE + verified price).`);

if (!values.apply) {
  console.log('Dry run only. Re-run with --apply --verified-by "<name>" --source "<document reference>" to write.');
  process.exit(0);
}
if (!values['verified-by'] || !values.source) {
  console.error('--apply requires --verified-by and --source');
  process.exit(2);
}
const pool = createPool(loadConfig().DATABASE_URL, 2);
try {
  const r = await applyDataset(pool, report, { verifiedBy: values['verified-by'], sourceReference: values.source, csvText: csv });
  console.log(`Applied: ${r.updated} securities updated and marked VERIFIED_IMPORT.`);
} finally {
  await pool.end();
}
