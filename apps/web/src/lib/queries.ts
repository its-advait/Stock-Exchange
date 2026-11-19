import type { PortfolioHistoryView } from '@aez/shared';
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, errorMessage, type HistoryInterval } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
    },
  },
});

/** Query keys. Realtime handlers invalidate by these prefixes. */
export const qk = {
  me: ['me'] as const,
  status: ['market', 'status'] as const,
  summary: ['market', 'summary'] as const,
  securities: ['securities'] as const,
  security: (t: string) => ['security', t] as const,
  book: (t: string) => ['book', t] as const,
  trades: (t: string) => ['trades', t] as const,
  history: (t: string, i: string) => ['history', t, i] as const,
  movers: ['market', 'movers'] as const,
  tape: ['market', 'tape'] as const,
  leaderboard: ['leaderboard'] as const,
  boards: ['leaderboard', 'boards'] as const,
  trader: (u: string) => ['leaderboard', 'trader', u.toLowerCase()] as const,
  news: (t?: string) => ['news', t ?? 'all'] as const,
  portfolio: ['account', 'portfolio'] as const,
  portfolioHistory: (r: string) => ['account', 'portfolio-history', r] as const,
  myTrades: ['account', 'trades'] as const,
  orders: (status: string, t?: string) => ['account', 'orders', status, t ?? 'all'] as const,
  cashLedger: ['account', 'ledger', 'cash'] as const,
  positionLedger: ['account', 'ledger', 'positions'] as const,
  watchlist: ['account', 'watchlist'] as const,
};

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      try {
        return (await api.me()).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export const useStatus = () => useQuery({ queryKey: qk.status, queryFn: api.status, refetchInterval: 60_000 });
export const useSummary = () => useQuery({ queryKey: qk.summary, queryFn: api.summary });
export const useSecurities = () => useQuery({ queryKey: qk.securities, queryFn: () => api.securities() });
export const useSecurity = (t: string) => useQuery({ queryKey: qk.security(t), queryFn: () => api.security(t), retry: false });
export const useBook = (t: string) => useQuery({ queryKey: qk.book(t), queryFn: () => api.book(t, 12) });
export const useTrades = (t: string) => useQuery({ queryKey: qk.trades(t), queryFn: () => api.trades(t, 40) });
export const useHistory = (t: string, i: HistoryInterval) =>
  useQuery({ queryKey: qk.history(t, i), queryFn: () => api.history(t, i, i === 'trade' ? 1000 : 500) });
export const useMovers = () => useQuery({ queryKey: qk.movers, queryFn: () => api.movers(5) });
export const useTape = (limit = 30) => useQuery({ queryKey: [...qk.tape, limit], queryFn: () => api.tape(limit) });
export const useLeaderboard = (limit = 100) => useQuery({ queryKey: [...qk.leaderboard, 'list', limit], queryFn: () => api.leaderboard(limit) });
export const useBoards = () => useQuery({ queryKey: qk.boards, queryFn: () => api.boards(10) });
export const useTrader = (u: string) => useQuery({ queryKey: qk.trader(u), queryFn: () => api.trader(u), retry: false });
export const useNews = (ticker?: string, limit = 20) =>
  useQuery({ queryKey: [...qk.news(ticker), limit], queryFn: () => api.news({ ticker, limit }) });

export function useAuthed() {
  const me = useMe();
  return !!me.data;
}

export const usePortfolio = () => {
  const authed = useAuthed();
  return useQuery({ queryKey: qk.portfolio, queryFn: api.portfolio, enabled: authed });
};
export const usePortfolioHistory = (range: PortfolioHistoryView['range']) => {
  const authed = useAuthed();
  return useQuery({ queryKey: qk.portfolioHistory(range), queryFn: () => api.portfolioHistory(range), enabled: authed });
};
export const useMyTrades = () => {
  const authed = useAuthed();
  return useQuery({ queryKey: qk.myTrades, queryFn: () => api.myTrades(200), enabled: authed });
};
export const useOrders = (status: 'open' | 'all', ticker?: string) => {
  const authed = useAuthed();
  return useQuery({ queryKey: qk.orders(status, ticker), queryFn: () => api.orders({ status, ticker, limit: 200 }), enabled: authed });
};
export const useCashLedger = () => {
  const authed = useAuthed();
  return useQuery({ queryKey: qk.cashLedger, queryFn: () => api.cashLedger(200), enabled: authed });
};
export const usePositionLedger = () => {
  const authed = useAuthed();
  return useQuery({ queryKey: qk.positionLedger, queryFn: () => api.positionLedger(200), enabled: authed });
};
export const useWatchlist = () => {
  const authed = useAuthed();
  return useQuery({ queryKey: qk.watchlist, queryFn: api.watchlist, enabled: authed });
};

export function useToggleWatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticker, watched }: { ticker: string; watched: boolean }) => (watched ? api.unwatch(ticker) : api.watch(ticker)),
    onSuccess: (tickers, v) => {
      qc.setQueryData(qk.watchlist, tickers);
      toast.success(v.watched ? `Removed ${v.ticker} from your watchlist` : `Added ${v.ticker} to your watchlist`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelOrder(id),
    onSuccess: (r) => {
      toast.success(`Cancelled ${r.order.side.toLowerCase()} order for ${r.order.ticker}`, {
        description: r.order.filledQuantity > 0 ? `${r.order.filledQuantity} of ${r.order.quantity} shares had already filled.` : 'Reserved funds/shares were released.',
      });
      void qc.invalidateQueries({ queryKey: ['account'] });
      void qc.invalidateQueries({ queryKey: qk.book(r.order.ticker) });
    },
    onError: (e) => {
      toast.error(errorMessage(e, { ORDER_NOT_OPEN: 'That order is no longer open — it may have just filled.' }));
      void qc.invalidateQueries({ queryKey: ['account'] });
    },
  });
}
