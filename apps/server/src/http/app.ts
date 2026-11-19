import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.js';
import { bigintReplacer } from '../lib/json.js';
import { resolveSession } from '../services/sessions.js';
import type { AppContext } from './context.js';
import { accountRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { marketRoutes } from './routes/market.js';
import { orderRoutes } from './routes/orders.js';

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const { cfg } = ctx;
  const app = Fastify({
    logger: cfg.LOG_LEVEL === 'silent' ? false : { level: cfg.LOG_LEVEL, redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: cfg.TRUST_PROXY,
    bodyLimit: 32 * 1024,
  });

  // Only JSON bodies are accepted (text/plain would enable simple-form CSRF).
  app.removeContentTypeParser('text/plain');
  app.setReplySerializer((payload) => JSON.stringify(payload, bigintReplacer));

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } });
  await app.register(cors, {
    origin: cfg.WEB_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key'],
  });
  await app.register(cookie);

  app.decorateRequest('user', null);
  const policy = { ttlHours: cfg.SESSION_TTL_HOURS, idleHours: cfg.SESSION_IDLE_HOURS };

  app.addHook('onRequest', async (req) => {
    // CSRF defense in depth (cookies are SameSite=Lax): browsers always send Origin on
    // cross-origin state-changing requests; reject any origin that is not allow-listed.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && !cfg.WEB_ORIGINS.includes(origin)) throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origin not allowed');
    }
    const token = req.cookies[cfg.SESSION_COOKIE_NAME];
    req.user = token ? await resolveSession(ctx.pool, token, policy) : null;
  });

  if (cfg.RATE_LIMIT_ENABLED) {
    await app.register(rateLimit, {
      global: true,
      max: 600,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (req) => (req.user ? `u:${req.user.id}` : `ip:${req.ip}`),
      errorResponseBuilder: (_req, ctxRl) => ({
        statusCode: 429,
        error: { code: 'RATE_LIMITED', message: `Too many requests; retry in ${Math.ceil(ctxRl.ttl / 1000)}s` },
      }),
    });
  }

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const e = err as { statusCode?: number; code?: string; message?: string; error?: { code: string } };
    if (e.statusCode === 429) {
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    }
    if (typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: e.code ?? 'BAD_REQUEST', message: e.message ?? 'Bad request' } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));

  app.get('/health', async () => ({ ok: true }));
  app.get('/ready', async () => {
    await ctx.pool.query('SELECT 1');
    return { ok: true };
  });

  await app.register(async (api) => {
    await authRoutes(api, ctx);
    await marketRoutes(api, ctx);
    await orderRoutes(api, ctx);
    await accountRoutes(api, ctx);
    await api.register(async (admin) => adminRoutes(admin, ctx), { prefix: '/admin' });
  }, { prefix: '/api' });

  return app;
}
