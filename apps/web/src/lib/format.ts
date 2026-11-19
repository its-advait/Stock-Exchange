import { formatBps, formatCents } from '@aez/shared';

/** Integer cents -> "$1,234.56". Null-safe. */
export function money(cents: number | null | undefined, fallback = '—'): string {
  return cents === null || cents === undefined ? fallback : formatCents(cents);
}

/** Signed money: "+$12.00" / "-$3.40" / "$0.00". */
export function signedMoney(cents: number | null | undefined, fallback = '—'): string {
  if (cents === null || cents === undefined) return fallback;
  if (cents === 0) return formatCents(0);
  return cents > 0 ? `+${formatCents(cents)}` : formatCents(cents);
}

/** Compact money for large values: $12.3K, $1.20M. Display only. */
export function compactMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const d = cents / 100;
  const a = Math.abs(d);
  if (a >= 1e6) return `${d < 0 ? '-' : ''}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${d < 0 ? '-' : ''}$${(a / 1e3).toFixed(1)}K`;
  return formatCents(cents);
}

export function pct(bps: number | null | undefined, fallback = '—'): string {
  return bps === null || bps === undefined ? fallback : formatBps(bps);
}

/** Integer basis points of part/whole, computed on integers. */
export function bpsOf(part: number, whole: number): number | null {
  if (!whole) return null;
  return Number((BigInt(part) * 10000n) / BigInt(whole));
}

export function int(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toLocaleString('en-US');
}

export function compactInt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

export function tone(v: number | null | undefined): 'up' | 'down' | 'flat' {
  if (v === null || v === undefined || v === 0) return 'flat';
  return v > 0 ? 'up' : 'down';
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "$12.50" / "12.5" -> 1250 integer cents, or null. String-based: no float math on money. */
export function parseMoneyInput(s: string): number | null {
  const v = s.trim().replace(/,/g, '');
  if (!v) return null;
  const m = /^\$?(\d{1,7})(?:\.(\d{0,2}))?$/.exec(v);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
}

export function centsToInput(c: number): string {
  return `${Math.trunc(c / 100)}.${String(Math.abs(c % 100)).padStart(2, '0')}`;
}
