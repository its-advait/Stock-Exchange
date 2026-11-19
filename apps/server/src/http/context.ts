import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';
import type { AuthenticatedUser } from '../services/sessions.js';

export interface AppContext {
  pool: pg.Pool;
  cfg: AppConfig;
  /** Called after commits that enqueue outbox events, to reduce latency (the relay also polls/LISTENs). */
  kickOutbox: () => void;
  /** Disconnect sockets bound to a session (logout). */
  disconnectSession: (sessionId: string) => void;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }
}

export function requireUser(req: FastifyRequest): AuthenticatedUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireAdmin(req: FastifyRequest): AuthenticatedUser {
  const u = requireUser(req);
  if (u.role !== 'ADMIN') throw forbidden('Administrator access required');
  return u;
}

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      'Request validation failed',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

export const uuidParam = z.object({ id: z.uuid() });
export const tickerParam = z.object({ ticker: z.string().regex(/^[A-Za-z]{1,8}$/).transform((s) => s.toUpperCase()) });

export function send(reply: FastifyReply, status: number, body: unknown) {
  return reply.code(status).send(body);
}
