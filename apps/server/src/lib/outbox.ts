import type { Queryable } from '../db/pool.js';
import { toJson } from './json.js';

export const OUTBOX_CHANNEL = 'aez_outbox';

export interface OutboxMessage {
  event: string;
  room: string;
  payload: unknown;
}

/**
 * Enqueue real-time events INSIDE the caller's transaction. They become visible
 * to the relay only if (and when) that transaction commits. pg_notify is also
 * transactional: the wake-up is delivered at commit, never on rollback.
 */
export async function enqueueOutbox(c: Queryable, messages: OutboxMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const events: string[] = [];
  const rooms: string[] = [];
  const payloads: string[] = [];
  for (const m of messages) {
    events.push(m.event);
    rooms.push(m.room);
    payloads.push(toJson(m.payload));
  }
  await c.query(
    `INSERT INTO outbox_events (event, room, payload)
     SELECT e, r, p::jsonb FROM unnest($1::text[], $2::text[], $3::text[]) WITH ORDINALITY AS x(e, r, p, n) ORDER BY n`,
    [events, rooms, payloads],
  );
  await c.query(`SELECT pg_notify($1, '')`, [OUTBOX_CHANNEL]);
}

export const rooms = {
  market: 'market',
  ticker: (t: string) => `ticker:${t}`,
  user: (id: string) => `user:${id}`,
};
