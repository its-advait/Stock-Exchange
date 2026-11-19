/**
 * JSON helpers for bigint values. Money/quantities are bigint internally and are
 * emitted as JSON numbers; we refuse to silently lose precision.
 */
export function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new RangeError(`bigint ${value} exceeds JSON safe integer range`);
    }
    return Number(value);
  }
  return value;
}

export function toJson(value: unknown): string {
  return JSON.stringify(value, bigintReplacer);
}

/** bigint | null -> number | null with a safety check. */
export function num(v: bigint): number;
export function num(v: bigint | null | undefined): number | null;
export function num(v: bigint | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`bigint ${v} exceeds safe integer range`);
  }
  return Number(v);
}

export function iso(d: Date | string | null | undefined): string | null {
  if (d === null || d === undefined) return null;
  return (d instanceof Date ? d : new Date(d)).toISOString();
}
