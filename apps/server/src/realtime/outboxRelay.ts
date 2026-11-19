/**
 * Transactional outbox relay.
 *
 * Events are written to outbox_events in the SAME transaction as the state
 * change, so they exist iff the change committed. This relay:
 *   1. LISTENs on `aez_outbox` (pg_notify fires only at commit) for low latency,
 *   2. polls as a fallback (missed notifications, restarts),
 *   3. claims batches with FOR UPDATE SKIP LOCKED (safe with many instances),
 *   4. emits each event, then marks it published in the same claim transaction.
 *
 * Delivery is at-least-once (a crash between emit and commit re-emits). Every
 * payload carries `eventId` (the outbox id) so clients can de-duplicate, and
 * book events carry `bookVersion` so clients can detect gaps and refetch.
 * With SOCKET_IO_PG_ADAPTER=true, io.to(room).emit fans out to sockets on all
 * instances, so each event only needs to be emitted once cluster-wide.
 */
import type pg from 'pg';
import { withTx } from '../db/tx.js';
import { OUTBOX_CHANNEL } from '../lib/outbox.js';

export interface Emitter {
  emit(room: string, event: string, payload: Record<string, unknown>): void;
}

export class OutboxRelay {
  private listener: pg.PoolClient | null = null;
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<void> | null = null;
  private again = false;
  private stopped = false;

  constructor(
    private readonly pool: pg.Pool,
    private readonly emitter: Emitter,
    private readonly opts: { pollMs: number; batchSize?: number; log?: (msg: string, err?: unknown) => void } = { pollMs: 1000 },
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    try {
      this.listener = await this.pool.connect();
      this.listener.on('notification', () => void this.kick());
      this.listener.on('error', (e) => this.opts.log?.('outbox listener error', e));
      await this.listener.query(`LISTEN ${OUTBOX_CHANNEL}`);
    } catch (e) {
      this.opts.log?.('outbox LISTEN unavailable; polling only', e);
      this.listener?.release(true);
      this.listener = null;
    }
    this.timer = setInterval(() => void this.kick(), this.opts.pollMs);
    await this.kick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.draining?.catch(() => undefined);
    if (this.listener) {
      try {
        await this.listener.query(`UNLISTEN ${OUTBOX_CHANNEL}`);
      } catch {
        /* ignore */
      }
      this.listener.release();
      this.listener = null;
    }
  }

  /** Drain until empty. Concurrent kicks coalesce. Returns when the current drain completes. */
  kick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.draining) {
      this.again = true;
      return this.draining;
    }
    this.draining = (async () => {
      try {
        do {
          this.again = false;
          while (!this.stopped && (await this.drainBatch()) > 0) {
            /* keep draining */
          }
        } while (this.again && !this.stopped);
      } catch (e) {
        this.opts.log?.('outbox drain failed', e);
      } finally {
        this.draining = null;
      }
    })();
    return this.draining;
  }

  private async drainBatch(): Promise<number> {
    const batch = this.opts.batchSize ?? 200;
    return withTx(this.pool, async (c) => {
      const r = await c.query<{ id: bigint; event: string; room: string; payload: Record<string, unknown> }>(
        `SELECT id, event, room, payload FROM outbox_events
          WHERE published_at IS NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [batch],
      );
      if (r.rows.length === 0) return 0;
      for (const e of r.rows) {
        this.emitter.emit(e.room, e.event, { eventId: Number(e.id), ...e.payload });
      }
      await c.query(`UPDATE outbox_events SET published_at = now(), attempts = attempts + 1 WHERE id = ANY($1::bigint[])`, [
        r.rows.map((e) => e.id),
      ]);
      return r.rows.length;
    });
  }
}
