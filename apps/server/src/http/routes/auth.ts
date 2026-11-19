import { loginSchema, registerSchema, type MeResponse } from '@aez/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createUser } from '../../services/accounts.js';
import { authenticate, createSession, revokeSession } from '../../services/sessions.js';
import { parse, requireUser, type AppContext } from '../context.js';
import { iso } from '../../lib/json.js';

const authRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const { cfg, pool } = ctx;
  const policy = { ttlHours: cfg.SESSION_TTL_HOURS, idleHours: cfg.SESSION_IDLE_HOURS };

  const setSessionCookie = (reply: FastifyReply, token: string, expiresAt: Date) =>
    reply.setCookie(cfg.SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: cfg.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });

  app.post('/auth/register', { config: authRateLimit }, async (req, reply) => {
    const body = parse(registerSchema, req.body);
    const user = await createUser(pool, { username: body.username, password: body.password, startingCashCents: cfg.STARTING_CASH_CENTS });
    const s = await createSession(pool, user.id, policy, { ip: req.ip, userAgent: req.headers['user-agent'] });
    setSessionCookie(reply, s.token, s.expiresAt);
    const res: MeResponse = { user: { id: user.id, username: user.username, role: user.role, createdAt: iso(user.created_at)! } };
    return reply.code(201).send(res);
  });

  app.post('/auth/login', { config: authRateLimit }, async (req, reply) => {
    const body = parse(loginSchema, req.body);
    const user = await authenticate(pool, body.username, body.password);
    // Rotate: any session presented with this request is revoked.
    if (req.user) await revokeSession(pool, req.user.sessionId);
    const s = await createSession(pool, user.id, policy, { ip: req.ip, userAgent: req.headers['user-agent'] });
    setSessionCookie(reply, s.token, s.expiresAt);
    const res: MeResponse = { user: { id: user.id, username: user.username, role: user.role, createdAt: iso(user.created_at)! } };
    return res;
  });

  app.post('/auth/logout', async (req, reply) => {
    if (req.user) {
      await revokeSession(pool, req.user.sessionId);
      ctx.disconnectSession(req.user.sessionId);
    }
    reply.clearCookie(cfg.SESSION_COOKIE_NAME, { path: '/', httpOnly: true, secure: cfg.COOKIE_SECURE, sameSite: 'lax' });
    return reply.code(204).send();
  });

  app.get('/auth/me', async (req) => {
    const u = requireUser(req);
    const res: MeResponse = { user: { id: u.id, username: u.username, role: u.role, createdAt: iso(u.createdAt)! } };
    return res;
  });
}
