export interface TradabilityInput {
  status: 'ACTIVE' | 'HALTED' | 'SUSPENDED' | 'UNLISTED' | null;
  reference_price_cents: bigint | null;
}

/**
 * Single source of truth for "can this security trade right now?".
 * Unknown status or unverified reference price => NOT tradable.
 */
export function tradingBlockReason(sec: TradabilityInput, symbolHalted: boolean, marketHalted: boolean): string | null {
  if (marketHalted) return 'MARKET_HALTED';
  if (sec.status === null) return 'STATUS_UNVERIFIED';
  if (sec.status === 'SUSPENDED') return 'SECURITY_SUSPENDED';
  if (sec.status === 'UNLISTED') return 'SECURITY_UNLISTED';
  if (sec.status === 'HALTED') return 'SECURITY_LISTING_HALTED';
  if (sec.reference_price_cents === null) return 'REFERENCE_PRICE_UNVERIFIED';
  if (symbolHalted) return 'SYMBOL_HALTED';
  return null;
}
