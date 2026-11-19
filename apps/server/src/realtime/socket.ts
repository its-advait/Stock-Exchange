import type { Server as HttpServer } from 'node:http';
import { CANONICAL_TICKERS, type ClientToServerEvents, type ServerToClientEvents } from '@aez/shared';
import { createAdapter } from '@socket.io/postgres-adapter';
import type pg from 'pg';
import { Server } from 'socket.io';
import type { AppConfig } from '../config.js';
import { rooms } from '../lib/outbox.js';
import { resolveSession, type AuthenticatedUser } from '../services/sessions.js';

interface SocketData {
  user: AuthenticatedUser | null;
}

export type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Socket.IO server.
 *  - `market` room: auto-joined by everyone (prices, market status, resets).
 *  - `ticker:<T>` rooms: joined via `subscribe` (trades, book, price). Public market data.
 *  - `user:<id>` rooms: joined ONLY by the server, after validating the session
 *    cookie in the handshake. Clients cannot join arbitrary rooms.
 */
export async function createSocketServer(httpServer: HttpServer, pool: pg.Pool, cfg: AppConfig): Promise<IoServer> {
  const io: IoServer = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: cfg.WEB_ORIGINS, credentials: true },
    serveClient: false,
    maxHttpBufferSize: 16 * 1024,
  });
  if (cfg.SOCKET_IO_PG_ADAPTER) {
    await pool.query(`CREATE TABLE IF NOT EXISTS socket_io_attachments (
      id bigserial UNIQUE, created_at timestamptz DEFAULT NOW(), payload bytea)`);
    io.adapter(createAdapter(pool));
  }
  const policy = { ttlHours: cfg.SESSION_TTL_HOURS, idleHours: cfg.SESSION_IDLE_HOURS };

  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && !cfg.WEB_ORIGINS.includes(origin)) return next(new Error('Origin not allowed'));
      const token = readCookie(socket.handshake.headers.cookie, cfg.SESSION_COOKIE_NAME);
      socket.data.user = token ? await resolveSession(pool, token, policy) : null;
      next();
    } catch {
      next(new Error('Handshake failed'));
    }
  });

  io.on('connection', (socket) => {
    void socket.join(rooms.market);
    const user = socket.data.user;
    if (user) {
      void socket.join(rooms.user(user.id));
      void socket.join(`session:${user.sessionId}`);
    }
    socket.on('subscribe', (tickers, ack) => {
      if (!Array.isArray(tickers) || tickers.length > 50) return ack?.({ ok: false, subscribed: [], error: 'Invalid ticker list' });
      const valid = tickers.filter((t): t is string => typeof t === 'string' && CANONICAL_TICKERS.has(t.toUpperCase())).map((t) => t.toUpperCase());
      for (const t of valid) void socket.join(rooms.ticker(t));
      ack?.({ ok: true, subscribed: valid });
    });
    socket.on('unsubscribe', (tickers, ack) => {
      if (Array.isArray(tickers)) for (const t of tickers) if (typeof t === 'string') void socket.leave(rooms.ticker(t.toUpperCase()));
      ack?.({ ok: true });
    });
  });
  return io;
}
