/**
 * Socket.IO integration. Real-time events never become the source of truth: they
 * patch or invalidate React Query caches, and every reconnect refetches snapshots.
 *
 *  - De-duplication: delivery is at-least-once, so events are dropped by `eventId`.
 *  - Order books carry `bookVersion`: older snapshots are ignored, and a gap
 *    (version jump > 1 vs. what we hold) triggers a REST refetch.
 *  - Reconnects: all ticker rooms are re-joined and all market/account queries refetched.
 *  - Auth: the session cookie is read at handshake, so the socket reconnects on login/logout.
 */
import type { ClientToServerEvents, OrderBookView, ServerToClientEvents, TradeView } from '@aez/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { API_BASE } from './api';
import { cancelMessage } from './reasons';
import { qk, useMe } from './queries';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

interface RealtimeCtx {
  state: ConnectionState;
  subscribe: (tickers: string[]) => () => void;
  /** Last price-change direction per ticker (for flash effects driven by real events only). */
  lastTick: Record<string, { dir: 'up' | 'down'; at: number }>;
}

const Ctx = createContext<RealtimeCtx>({ state: 'connecting', subscribe: () => () => {}, lastTick: {} });

function debounced(fn: () => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (t) return;
    t = setTimeout(() => {
      t = null;
      fn();
    }, ms);
  };
}

function refetchEverything(qc: QueryClient) {
  void qc.invalidateQueries();
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useMe();
  const userId = me.data?.id ?? null;
  const [state, setState] = useState<ConnectionState>('connecting');
  const [lastTick, setLastTick] = useState<RealtimeCtx['lastTick']>({});
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const counts = useRef(new Map<string, number>());
  const seen = useRef<{ set: Set<number>; order: number[] }>({ set: new Set(), order: [] });

  useEffect(() => {
    if (me.isLoading) return;
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(API_BASE || undefined, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionDelay: 500,
      reconnectionDelayMax: 8000,
    });
    socketRef.current = socket;
    let everConnected = false;

    const fresh = (eventId: number) => {
      const s = seen.current;
      if (s.set.has(eventId)) return false;
      s.set.add(eventId);
      s.order.push(eventId);
      if (s.order.length > 2000) s.set.delete(s.order.shift()!);
      return true;
    };

    const marketRefresh = debounced(() => {
      void qc.invalidateQueries({ queryKey: qk.securities });
      void qc.invalidateQueries({ queryKey: ['market'] });
      void qc.invalidateQueries({ queryKey: qk.leaderboard });
    }, 700);
    const accountRefresh = debounced(() => {
      void qc.invalidateQueries({ queryKey: ['account'] });
    }, 300);

    const resubscribe = () => {
      const tickers = [...counts.current.keys()];
      if (tickers.length) socket.emit('subscribe', tickers);
    };

    socket.on('connect', () => {
      setState('live');
      resubscribe();
      // After any reconnect (and the first connect after a login change) rebuild state from snapshots.
      if (everConnected) refetchEverything(qc);
      everConnected = true;
    });
    socket.on('disconnect', (reason) => {
      setState(reason === 'io client disconnect' ? 'offline' : 'reconnecting');
    });
    socket.io.on('reconnect_attempt', () => setState('reconnecting'));
    socket.on('connect_error', () => setState(everConnected ? 'reconnecting' : 'offline'));

    socket.on('trade', (e) => {
      if (!fresh(e.eventId)) return;
      qc.setQueryData<TradeView[]>(qk.trades(e.ticker), (old) =>
        old ? (old.some((t) => t.id === e.trade.id) ? old : [e.trade, ...old].slice(0, 60)) : old,
      );
      void qc.invalidateQueries({ queryKey: ['history', e.ticker] });
      void qc.invalidateQueries({ queryKey: qk.security(e.ticker) });
      marketRefresh();
    });

    socket.on('book', (e) => {
      if (!fresh(e.eventId)) return;
      const cur = qc.getQueryData<OrderBookView>(qk.book(e.ticker));
      if (cur && e.book.bookVersion <= cur.bookVersion) return; // stale/out-of-order snapshot
      // The pushed snapshot is full-depth, so it can replace ours. A version gap only means
      // intermediate snapshots were missed, which a full snapshot already supersedes.
      qc.setQueryData(qk.book(e.ticker), e.book);
    });

    socket.on('price', (e) => {
      if (!fresh(e.eventId)) return;
      setLastTick((prev) => {
        const sec = qc.getQueryData<{ ticker: string; displayPriceCents: number | null }[]>(qk.securities)?.find(
          (s) => s.ticker === e.ticker,
        );
        const before = sec?.displayPriceCents ?? null;
        if (before === null || before === e.lastPriceCents) return prev;
        return { ...prev, [e.ticker]: { dir: e.lastPriceCents > before ? 'up' : 'down', at: Date.now() } };
      });
      marketRefresh();
      if (userId) accountRefresh();
    });

    socket.on('market.status', (e) => {
      if (!fresh(e.eventId)) return;
      toast(e.open ? 'Trading resumed' : 'Market halted', { description: e.reason ?? undefined });
      void qc.invalidateQueries({ queryKey: qk.status });
      marketRefresh();
      void qc.invalidateQueries({ queryKey: ['security'] });
    });
    socket.on('security.status', (e) => {
      if (!fresh(e.eventId)) return;
      void qc.invalidateQueries({ queryKey: qk.security(e.ticker) });
      marketRefresh();
    });
    socket.on('market.reset', (e) => {
      if (!fresh(e.eventId)) return;
      toast.warning('The simulation was reset', { description: `A new epoch (#${e.epoch}) has started. Everyone is back to $10,000.` });
      refetchEverything(qc);
    });
    socket.on('news', (e) => {
      if (!fresh(e.eventId)) return;
      void qc.invalidateQueries({ queryKey: ['news'] });
      toast(`📰 ${e.post.headline}`, { description: `${e.post.label}${e.post.ticker ? ` · ${e.post.ticker}` : ''}` });
    });

    socket.on('order', (e) => {
      if (!fresh(e.eventId)) return;
      const o = e.order;
      // Fills of *resting* orders happen while the user is elsewhere; tell them.
      if (o.type === 'LIMIT' && (o.status === 'FILLED' || o.status === 'PARTIALLY_FILLED') && o.filledQuantity > 0) {
        const prev = qc
          .getQueriesData<{ id: string; filledQuantity: number }[]>({ queryKey: ['account', 'orders'] })
          .flatMap(([, d]) => d ?? [])
          .find((x) => x.id === o.id);
        if (prev && prev.filledQuantity < o.filledQuantity) {
          toast.success(`${o.side === 'BUY' ? 'Bought' : 'Sold'} ${o.filledQuantity - prev.filledQuantity} ${o.ticker}`, {
            description: o.status === 'FILLED' ? 'Your resting limit order is now fully filled.' : `${o.remainingQuantity} shares still resting on the book.`,
          });
        }
      }
      if (o.status === 'CANCELLED' && o.cancelReason && o.cancelReason !== 'USER_REQUESTED' && o.type === 'LIMIT') {
        toast.message(`${o.ticker} order cancelled`, { description: cancelMessage(o.cancelReason) });
      }
      accountRefresh();
    });
    socket.on('portfolio.changed', (e) => {
      if (!fresh(e.eventId)) return;
      accountRefresh();
    });

    return () => {
      socket.removeAllListeners();
      socket.io.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
    // Reconnect when the authenticated identity changes (cookie is read at handshake).
  }, [qc, userId, me.isLoading]);

  const value = useMemo<RealtimeCtx>(
    () => ({
      state,
      lastTick,
      subscribe: (tickers) => {
        const add: string[] = [];
        for (const t of tickers) {
          const n = counts.current.get(t) ?? 0;
          counts.current.set(t, n + 1);
          if (n === 0) add.push(t);
        }
        if (add.length) socketRef.current?.emit('subscribe', add);
        return () => {
          const remove: string[] = [];
          for (const t of tickers) {
            const n = (counts.current.get(t) ?? 1) - 1;
            if (n <= 0) {
              counts.current.delete(t);
              remove.push(t);
            } else counts.current.set(t, n);
          }
          if (remove.length) socketRef.current?.emit('unsubscribe', remove);
        };
      },
    }),
    [state, lastTick],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useRealtime = () => useContext(Ctx);

/** Join ticker rooms for the lifetime of the component. */
export function useTickerRoom(tickers: string[]) {
  const { subscribe } = useRealtime();
  const key = tickers.join(',');
  useEffect(() => {
    if (!key) return;
    return subscribe(key.split(','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
