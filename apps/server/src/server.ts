import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { AppConfig } from './config.js';
import { createPool } from './db/pool.js';
import { buildApp } from './http/app.js';
import { OutboxRelay } from './realtime/outboxRelay.js';
import { createSocketServer, type IoServer } from './realtime/socket.js';
import { configurePasswordHashing } from './services/passwords.js';

export interface RunningServer {
  app: FastifyInstance;
  io: IoServer;
  relay: OutboxRelay;
  pool: pg.Pool;
  close: () => Promise<void>;
}

/** Wire pool + HTTP + Socket.IO + outbox relay. Does not listen. */
export async function createServer(cfg: AppConfig, pool: pg.Pool = createPool(cfg.DATABASE_URL, cfg.DATABASE_POOL_MAX)): Promise<RunningServer> {
  configurePasswordHashing({ memoryCost: cfg.ARGON2_MEMORY_KIB, timeCost: cfg.ARGON2_TIME_COST });
  let io: IoServer | null = null;
  let relay: OutboxRelay | null = null;
  const app = await buildApp({
    pool,
    cfg,
    kickOutbox: () => void relay?.kick(),
    disconnectSession: (sid) => io?.in(`session:${sid}`).disconnectSockets(true),
  });
  await app.ready();
  io = await createSocketServer(app.server, pool, cfg);
  const ioRef = io;
  relay = new OutboxRelay(
    pool,
    {
      // Untyped broadcast: outbox payloads are produced by typed code paths in the engine/services.
      emit: (room, event, payload) => (ioRef.to(room) as unknown as { emit: (e: string, p: unknown) => void }).emit(event, payload),
    },
    { pollMs: cfg.OUTBOX_POLL_MS, log: (m, e) => app.log.warn({ err: e }, m) },
  );
  const relayRef = relay;
  return {
    app,
    io,
    relay,
    pool,
    close: async () => {
      await relayRef.stop();
      await new Promise<void>((r) => ioRef.close(() => r()));
      await app.close();
      await pool.end();
    },
  };
}
