import type { OrderView, TradeView } from '@aez/shared';
import { iso, num } from './json.js';

/** Raw `orders` row as returned by node-postgres (snake_case, int8 -> bigint). */
export interface OrderRow {
  id: string;
  seq: bigint;
  user_id: string;
  ticker: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  status: OrderView['status'];
  quantity: bigint;
  filled_quantity: bigint;
  limit_price_cents: bigint | null;
  max_spend_cents: bigint | null;
  reserved_cents: bigint;
  reserved_quantity: bigint;
  filled_notional_cents: bigint;
  reject_reason: string | null;
  cancel_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export const ORDER_COLUMNS = `id, seq, user_id, ticker, side, type, status, quantity, filled_quantity, limit_price_cents,
  max_spend_cents, reserved_cents, reserved_quantity, filled_notional_cents, reject_reason, cancel_reason, created_at, updated_at`;

export function orderView(r: OrderRow): OrderView {
  return {
    id: r.id,
    seq: num(r.seq),
    ticker: r.ticker,
    side: r.side,
    type: r.type,
    status: r.status,
    quantity: num(r.quantity),
    filledQuantity: num(r.filled_quantity),
    remainingQuantity: num(r.quantity - r.filled_quantity),
    limitPriceCents: num(r.limit_price_cents),
    maxSpendCents: num(r.max_spend_cents),
    reservedCents: num(r.reserved_cents),
    reservedQuantity: num(r.reserved_quantity),
    filledNotionalCents: num(r.filled_notional_cents),
    // Integer average, rounded half up; display only.
    averageFillPriceCents:
      r.filled_quantity > 0n ? num((r.filled_notional_cents * 2n + r.filled_quantity) / (2n * r.filled_quantity)) : null,
    rejectReason: r.reject_reason,
    cancelReason: r.cancel_reason,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

export interface TradeRow {
  id: bigint;
  ticker: string;
  price_cents: bigint;
  quantity: bigint;
  aggressor_side: 'BUY' | 'SELL';
  executed_at: Date;
}

export function tradeView(r: TradeRow): TradeView {
  return {
    id: num(r.id),
    ticker: r.ticker,
    priceCents: num(r.price_cents),
    quantity: num(r.quantity),
    aggressorSide: r.aggressor_side,
    executedAt: iso(r.executed_at)!,
  };
}
