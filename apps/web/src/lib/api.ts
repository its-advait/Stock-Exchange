/**
 * Typed client for the AEZ backend. Same-origin by default (Vite proxies /api in dev);
 * set VITE_API_URL to call a different origin (it must be in the server's WEB_ORIGINS).
 * Every request sends the HttpOnly session cookie (`credentials: 'include'`).
 */
import type {
  LeaderboardBoardsView,
  LeaderboardEntry,
  MarketStatusView,
  MarketSummaryView,
  MarketTradeView,
  MeResponse,
  MyTradeView,
  NewsPostRequest,
  NewsPostView,
  OrderBookView,
  OrderView,
  PlaceOrderRequest,
  PlaceOrderResponse,
  PortfolioHistoryView,
  PortfolioView,
  SecurityDetailView,
  SecurityView,
  TradeView,
  TraderProfileView,
} from '@aez/shared';

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    /** Body of the response, when the server sent one (e.g. a recorded rejected order on 422). */
    readonly body?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      credentials: 'include',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Can’t reach the exchange server. Check your connection.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    throw new ApiError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? res.statusText, e?.details, json);
  }
  return json as T;
}

const get = <T,>(p: string) => request<T>('GET', p);
const qs = (o: Record<string, string | number | boolean | null | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const r = s.toString();
  return r ? `?${r}` : '';
};

export type HistoryInterval = 'trade' | '1m' | '5m' | '15m' | '1h' | '1d';
export type HistoryPoint =
  | { kind: 'trade'; tradeId: number; at: string; priceCents: number; quantity: number }
  | { kind: 'bar'; at: string; openCents: number; highCents: number; lowCents: number; closeCents: number; volume: number; trades: number };
export interface PriceHistoryView {
  ticker: string;
  interval: string;
  referencePriceCents: number | null;
  referencePriceKind: 'VERIFIED' | 'SIMULATED' | null;
  points: HistoryPoint[];
}

export interface CashLedgerEntry {
  id: number;
  amountCents: number;
  balanceAfterCents: number;
  reason: string;
  tradeId: number | null;
  orderId: string | null;
  createdAt: string;
  userId: string;
}
export interface PositionLedgerEntry {
  id: number;
  ticker: string;
  quantityDelta: number;
  quantityAfter: number;
  reason: string;
  tradeId: number | null;
  createdAt: string;
  userId: string;
}

export interface AdminUser {
  id: string;
  username: string;
  role: 'USER' | 'ADMIN';
  accountType: 'HUMAN' | 'MARKET_MAKER' | 'SIMULATION';
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
}
export interface MarketMakerView {
  account: { id: string; username: string; cashCents: number; reservedCashCents: number } | null;
  inventory: { ticker: string; quantity: number; reservedQuantity: number }[];
  configs: {
    ticker: string;
    inventory_shares: number;
    ask_levels: { offsetBps: number; quantity: number }[];
    bid_levels: { offsetBps: number; quantity: number }[];
    enabled: boolean;
    note: string;
    opened_epoch: number | null;
    opened_at: string | null;
  }[];
}
export interface AdminTradeRow {
  id: number;
  ticker: string;
  price_cents: number;
  quantity: number;
  buyer_id: string;
  seller_id: string;
  aggressor_side: 'BUY' | 'SELL';
  executed_at: string;
}
export interface AuditRow {
  id: number;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  created_at: string;
}
export interface IntegrityView {
  ok: boolean;
  violations: { check: string; detail: unknown }[] | string[];
  stats: { totalCashCents: string; grantedCashCents: string; trades: number; openOrders: number };
}
export interface HaltRow {
  id: number;
  scope: 'MARKET' | 'SYMBOL';
  ticker: string | null;
  reason: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
}

export const api = {
  /* auth */
  me: () => get<MeResponse>('/auth/me'),
  login: (username: string, password: string) => request<MeResponse>('POST', '/auth/login', { username, password }),
  register: (username: string, password: string) => request<MeResponse>('POST', '/auth/register', { username, password }),
  logout: () => request<void>('POST', '/auth/logout'),

  /* market data */
  status: () => get<MarketStatusView>('/market/status'),
  summary: () => get<{ summary: MarketSummaryView }>('/market/summary').then((r) => r.summary),
  securities: (q?: string) => get<{ securities: SecurityView[] }>(`/securities${qs({ q })}`).then((r) => r.securities),
  security: (t: string) => get<{ security: SecurityDetailView }>(`/securities/${t}`).then((r) => r.security),
  book: (t: string, depth = 12) => get<{ book: OrderBookView }>(`/securities/${t}/book${qs({ depth })}`).then((r) => r.book),
  trades: (t: string, limit = 40) => get<{ trades: TradeView[] }>(`/securities/${t}/trades${qs({ limit })}`).then((r) => r.trades),
  history: (t: string, interval: HistoryInterval, limit = 500) =>
    get<PriceHistoryView>(`/securities/${t}/history${qs({ interval, limit })}`),
  movers: (limit = 5) => get<{ gainers: SecurityView[]; losers: SecurityView[] }>(`/market/movers${qs({ limit })}`),
  tape: (limit = 30) => get<{ trades: MarketTradeView[] }>(`/market/trades${qs({ limit })}`).then((r) => r.trades),
  leaderboard: (limit = 50, offset = 0) =>
    get<{ entries: LeaderboardEntry[] }>(`/leaderboard${qs({ limit, offset })}`).then((r) => r.entries),
  boards: (limit = 10) => get<{ boards: LeaderboardBoardsView }>(`/leaderboard/boards${qs({ limit })}`).then((r) => r.boards),
  trader: (u: string) => get<{ trader: TraderProfileView }>(`/traders/${encodeURIComponent(u)}`).then((r) => r.trader),
  news: (opts: { ticker?: string; limit?: number } = {}) =>
    get<{ posts: NewsPostView[] }>(`/news${qs({ ticker: opts.ticker, limit: opts.limit ?? 20 })}`).then((r) => r.posts),

  /* account */
  portfolio: () => get<{ portfolio: PortfolioView }>('/portfolio').then((r) => r.portfolio),
  portfolioHistory: (range: PortfolioHistoryView['range']) =>
    get<{ history: PortfolioHistoryView }>(`/portfolio/history${qs({ range })}`).then((r) => r.history),
  myTrades: (limit = 100) => get<{ trades: MyTradeView[] }>(`/account/trades${qs({ limit })}`).then((r) => r.trades),
  cashLedger: (limit = 100) => get<{ entries: CashLedgerEntry[] }>(`/account/ledger/cash${qs({ limit })}`).then((r) => r.entries),
  positionLedger: (limit = 100) =>
    get<{ entries: PositionLedgerEntry[] }>(`/account/ledger/positions${qs({ limit })}`).then((r) => r.entries),
  orders: (opts: { status?: 'open' | 'all'; ticker?: string; limit?: number } = {}) =>
    get<{ orders: OrderView[] }>(`/orders${qs({ status: opts.status ?? 'all', ticker: opts.ticker, limit: opts.limit ?? 100 })}`).then(
      (r) => r.orders,
    ),
  placeOrder: (body: PlaceOrderRequest, idempotencyKey: string) =>
    request<PlaceOrderResponse>('POST', '/orders', body, { 'Idempotency-Key': idempotencyKey }),
  cancelOrder: (id: string) => request<{ order: OrderView }>('DELETE', `/orders/${id}`),
  watchlist: () => get<{ tickers: string[] }>('/watchlist').then((r) => r.tickers),
  watch: (t: string) => request<{ tickers: string[] }>('PUT', `/watchlist/${t}`).then((r) => r.tickers),
  unwatch: (t: string) => request<{ tickers: string[] }>('DELETE', `/watchlist/${t}`).then((r) => r.tickers),

  /* admin */
  admin: {
    users: () => get<{ users: AdminUser[] }>('/admin/users?limit=500').then((r) => r.users),
    createUser: (b: { username: string; password: string; role: 'USER' | 'ADMIN' }) =>
      request<{ user: AdminUser }>('POST', '/admin/users', b),
    updateUser: (id: string, b: { role?: 'USER' | 'ADMIN'; status?: 'ACTIVE' | 'DISABLED' }) =>
      request<{ user: AdminUser }>('PATCH', `/admin/users/${id}`, b),
    haltMarket: (reason: string) => request('POST', '/admin/market/halt', { reason }),
    resumeMarket: (reason: string) => request('POST', '/admin/market/resume', { reason }),
    haltSymbol: (t: string, reason: string) => request('POST', `/admin/securities/${t}/halt`, { reason }),
    resumeSymbol: (t: string, reason: string) => request('POST', `/admin/securities/${t}/resume`, { reason }),
    listingStatus: (t: string, b: { status: string; reason: string; authorizationReference: string }) =>
      request('POST', `/admin/securities/${t}/listing-status`, b),
    simulatedReference: (t: string, b: { referencePriceCents: number; activate: boolean; note: string; acknowledgement: string }) =>
      request('POST', `/admin/securities/${t}/simulated-reference`, b),
    marketMaker: () => get<MarketMakerView>('/admin/market-maker'),
    configureMM: (
      t: string,
      b: { inventoryShares: number; askLevels: { offsetBps: number; quantity: number }[]; bidLevels: { offsetBps: number; quantity: number }[]; enabled: boolean; note: string },
    ) => request('PUT', `/admin/market-maker/${t}`, b),
    openMM: (t: string) => request<{ orders: unknown[]; issuedShares: number }>('POST', `/admin/market-maker/${t}/open`),
    trades: (limit = 100) => get<{ trades: AdminTradeRow[] }>(`/admin/trades${qs({ limit })}`).then((r) => r.trades),
    audit: (limit = 100) => get<{ entries: AuditRow[] }>(`/admin/audit-logs${qs({ limit })}`).then((r) => r.entries),
    halts: () => get<{ halts: HaltRow[] }>('/admin/halts').then((r) => r.halts),
    integrity: () => get<IntegrityView>('/admin/integrity'),
    news: () => get<{ posts: NewsPostView[] }>('/admin/news').then((r) => r.posts),
    createNews: (b: NewsPostRequest) => request<{ post: NewsPostView }>('POST', '/admin/news', b),
    setNewsHidden: (id: string, hidden: boolean) => request<{ post: NewsPostView }>('PATCH', `/admin/news/${id}`, { hidden }),
    cancelOrder: (id: string) => request('POST', `/admin/orders/${id}/cancel`),
    reset: (b: { confirmation: string; password: string; reason: string }) => request<Record<string, unknown>>('POST', '/admin/simulation/reset', b),
    resets: () => get<{ resets: Record<string, unknown>[] }>('/admin/simulation/resets').then((r) => r.resets),
  },
};

export function errorMessage(e: unknown, map: Record<string, string> = {}): string {
  if (e instanceof ApiError) {
    if (map[e.code]) return map[e.code]!;
    if (e.code === 'VALIDATION_FAILED' && Array.isArray(e.details) && e.details.length) {
      return (e.details as { message: string }[]).map((d) => d.message).join(' · ');
    }
    return e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}
