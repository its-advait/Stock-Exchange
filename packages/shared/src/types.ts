/**
 * API response types. All money fields are integer cents (JSON numbers, always
 * safe integers). All quantities are integer shares. Timestamps are ISO-8601.
 */

export type Role = 'USER' | 'ADMIN';
export type SecurityStatus = 'ACTIVE' | 'HALTED' | 'SUSPENDED' | 'UNLISTED';
export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';
export type OrderStatus = 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';
export type ReferencePriceKind = 'VERIFIED' | 'SIMULATED';
export type DisplayPriceKind = 'LAST_TRADE' | 'REFERENCE_VERIFIED' | 'REFERENCE_SIMULATED';

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface MeResponse {
  user: { id: string; username: string; role: Role; createdAt: string };
}

export interface SecurityView {
  ticker: string;
  name: string;
  originalRank: number;
  /** null = status not yet verified (treated as non-tradable). */
  listingStatus: SecurityStatus | null;
  tradable: boolean;
  /** Why trading is blocked, if it is. */
  tradingBlockReason: string | null;
  symbolHalted: boolean;
  referencePriceCents: number | null;
  referencePriceKind: ReferencePriceKind | null;
  lastPriceCents: number | null;
  lastTradeAt: string | null;
  /** lastPriceCents if the security has traded, else the reference price. */
  displayPriceCents: number | null;
  displayPriceKind: DisplayPriceKind | null;
  changeFromReferenceBps: number | null;
  bestBidCents: number | null;
  bestAskCents: number | null;
  volume24h: number;
  description: string;
  imageUrl: string | null;
}

export interface SecurityDetailView extends SecurityView {
  news: string | null;
  background: string | null;
  tradingRestriction: string | null;
  bookVersion: number;
  historicalNotes: { changeBps: number | null; note: string | null; kind: string }[];
}

export interface BookLevel {
  priceCents: number;
  quantity: number;
  orders: number;
}

export interface OrderBookView {
  ticker: string;
  bookVersion: number;
  bestBidCents: number | null;
  bestAskCents: number | null;
  spreadCents: number | null;
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface TradeView {
  id: number;
  ticker: string;
  priceCents: number;
  quantity: number;
  aggressorSide: OrderSide;
  executedAt: string;
}

export interface MyTradeView extends TradeView {
  side: OrderSide;
  orderId: string;
  liquidity: 'MAKER' | 'TAKER';
  notionalCents: number;
}

export interface OrderView {
  id: string;
  seq: number;
  ticker: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  quantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  limitPriceCents: number | null;
  maxSpendCents: number | null;
  reservedCents: number;
  reservedQuantity: number;
  /** Cash paid (buys) or received (sells) so far. */
  filledNotionalCents: number;
  averageFillPriceCents: number | null;
  rejectReason: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FillView {
  tradeId: number;
  priceCents: number;
  quantity: number;
  counterpartyOrderId: string;
}

export interface PlaceOrderResponse {
  order: OrderView;
  fills: FillView[];
  /** true when this response is a replay of an earlier request with the same Idempotency-Key. */
  replayed: boolean;
}

export interface HoldingView {
  ticker: string;
  name: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  markPriceCents: number | null;
  markPriceKind: DisplayPriceKind | null;
  marketValueCents: number;
  costBasisCents: number;
  unrealizedPnlCents: number;
  realizedPnlCents: number;
}

export interface PortfolioView {
  cashCents: number;
  reservedCashCents: number;
  availableCashCents: number;
  holdingsValueCents: number;
  totalValueCents: number;
  startingCashCents: number;
  totalPnlCents: number;
  realizedPnlCents: number;
  unrealizedPnlCents: number;
  rank: number | null;
  rankedUsers: number;
  holdings: HoldingView[];
  openOrders: OrderView[];
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  cashCents: number;
  holdingsValueCents: number;
  totalValueCents: number;
  pnlCents: number;
}

export interface MarketStatusView {
  open: boolean;
  marketHalt: { reason: string; startedAt: string } | null;
  epoch: number;
  serverTime: string;
}

/* ------------------------------ Socket.IO ------------------------------ */

/** Rooms: `market` (auto-joined), `ticker:<TICKER>` (via `subscribe`), `user:<id>` (auto, authenticated only). */
export interface ServerToClientEvents {
  trade: (e: { eventId: number; ticker: string; trade: TradeView }) => void;
  book: (e: { eventId: number; ticker: string; book: OrderBookView }) => void;
  price: (e: { eventId: number; ticker: string; lastPriceCents: number; lastTradeAt: string }) => void;
  'market.status': (e: { eventId: number; open: boolean; reason: string | null }) => void;
  'security.status': (e: { eventId: number; ticker: string }) => void;
  'market.reset': (e: { eventId: number; epoch: number }) => void;
  /** Account-specific; delivered only to the owning authenticated user. */
  order: (e: { eventId: number; order: OrderView }) => void;
  'portfolio.changed': (e: { eventId: number; reason: string }) => void;
}

export interface ClientToServerEvents {
  subscribe: (tickers: string[], ack?: (r: { ok: boolean; subscribed: string[]; error?: string }) => void) => void;
  unsubscribe: (tickers: string[], ack?: (r: { ok: boolean }) => void) => void;
}
