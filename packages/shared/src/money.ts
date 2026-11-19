/**
 * Money helpers. All monetary values are integer cents. Never use floating
 * point to compute money. These helpers only do string <-> integer
 * conversions for display and input parsing.
 */

/** Format integer cents (number or bigint) as a dollar string, e.g. 123456 -> "$1,234.56". */
export function formatCents(cents: number | bigint): string {
  let v = typeof cents === 'bigint' ? cents : BigInt(assertSafeInt(cents));
  const negative = v < 0n;
  if (negative) v = -v;
  const dollars = (v / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rem = (v % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}$${dollars}.${rem}`;
}

/**
 * Parse a decimal dollar string ("12", "12.5", "12.50", "$1,234.56") into integer cents
 * without floating point. Returns null when the string is not a valid amount with at
 * most two decimal places.
 */
export function parseDollarsToCents(input: string): bigint | null {
  const s = input.trim().replace(/^\$/, '').replace(/,/g, '');
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = BigInt(m[1]!);
  const frac = BigInt((m[2] ?? '').padEnd(2, '0') || '0');
  return whole * 100n + frac;
}

/** Format basis points as a signed percent string: 250 -> "+2.50%". */
export function formatBps(bps: number): string {
  assertSafeInt(bps);
  const sign = bps > 0 ? '+' : bps < 0 ? '-' : '';
  const a = Math.abs(bps);
  return `${sign}${Math.trunc(a / 100)}.${String(a % 100).padStart(2, '0')}%`;
}

function assertSafeInt(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Expected a safe integer, got ${n}`);
  return n;
}
