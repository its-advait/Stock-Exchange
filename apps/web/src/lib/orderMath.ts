/**
 * Pre-trade estimates computed from the live order book snapshot. These are
 * previews only: the server is the sole authority on what executes, and the UI
 * never shows a fill until the backend confirms one.
 */
import type { BookLevel, OrderSide } from '@aez/shared';

export interface FillEstimate {
  /** Shares that the visible book could fill right now. */
  fillableQty: number;
  /** Cash for those shares at resting prices (integer cents). */
  notionalCents: number;
  /** Volume-weighted average price, rounded to the cent (display only). */
  avgPriceCents: number | null;
  /** Worst price touched. */
  worstPriceCents: number | null;
  /** Requested quantity the visible book cannot fill. */
  shortfallQty: number;
  levelsUsed: number;
}

/**
 * Walk the opposite side of the book (asks for a buy, bids for a sell), best price
 * first, optionally bounded by a limit price and/or a spending cap.
 */
export function estimateFill(
  side: OrderSide,
  quantity: number,
  book: { bids: BookLevel[]; asks: BookLevel[] } | undefined,
  opts: { limitPriceCents?: number | null; maxSpendCents?: number | null } = {},
): FillEstimate {
  const levels = book ? (side === 'BUY' ? book.asks : book.bids) : [];
  let remaining = Math.max(0, Math.trunc(quantity));
  let qty = 0;
  let notional = 0;
  let worst: number | null = null;
  let used = 0;
  for (const l of levels) {
    if (remaining <= 0) break;
    if (opts.limitPriceCents != null) {
      if (side === 'BUY' && l.priceCents > opts.limitPriceCents) break;
      if (side === 'SELL' && l.priceCents < opts.limitPriceCents) break;
    }
    let take = Math.min(remaining, l.quantity);
    if (opts.maxSpendCents != null && side === 'BUY') {
      const affordable = Math.floor((opts.maxSpendCents - notional) / l.priceCents);
      take = Math.min(take, Math.max(0, affordable));
      if (take <= 0) break;
    }
    qty += take;
    notional += take * l.priceCents;
    remaining -= take;
    worst = l.priceCents;
    used++;
  }
  return {
    fillableQty: qty,
    notionalCents: notional,
    avgPriceCents: qty > 0 ? Math.round(notional / qty) : null,
    worstPriceCents: worst,
    shortfallQty: Math.max(0, Math.trunc(quantity) - qty),
    levelsUsed: used,
  };
}

/** Largest whole-share quantity purchasable from the visible asks within a cash budget. */
export function maxAffordable(asks: BookLevel[], budgetCents: number): number {
  let budget = budgetCents;
  let qty = 0;
  for (const l of asks) {
    const n = Math.min(l.quantity, Math.floor(budget / l.priceCents));
    qty += n;
    budget -= n * l.priceCents;
    if (n < l.quantity) break;
  }
  return qty;
}

export function newIdempotencyKey(): string {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `web-${id}`;
}
