import { idempotencyKeySchema, placeOrderSchema } from '@aez/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cancelOrder, placeOrder } from '../../engine/matching.js';
import { getOrder, listOrders } from '../../services/portfolio.js';
import { parse, requireUser, uuidParam, type AppContext } from '../context.js';

export async function orderRoutes(app: FastifyInstance, ctx: AppContext) {
  const { pool } = ctx;

  /**
   * Place an order. Requires an `Idempotency-Key` header; retries with the same
   * key and body return the original result (with `replayed: true`).
   * 201 = accepted (may be filled, resting, or a market order whose remainder was cancelled)
   * 422 = rejected (insufficient funds/shares, halted, not tradable); the rejection is recorded.
   */
  app.post('/orders', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = requireUser(req);
    const key = parse(idempotencyKeySchema, req.headers['idempotency-key']);
    const body = parse(placeOrderSchema, req.body);
    const out = await placeOrder(pool, {
      userId: user.id,
      ticker: body.ticker,
      side: body.side,
      type: body.type,
      quantity: BigInt(body.quantity),
      limitPriceCents: body.limitPriceCents !== undefined ? BigInt(body.limitPriceCents) : null,
      maxSpendCents: body.maxSpendCents !== undefined ? BigInt(body.maxSpendCents) : null,
      idempotencyKey: key,
    });
    ctx.kickOutbox();
    return reply.code(out.httpStatus).send(out.body);
  });

  app.delete('/orders/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(uuidParam, req.params);
    const order = await cancelOrder(pool, { orderId: id, actorUserId: user.id });
    ctx.kickOutbox();
    return { order };
  });

  app.get('/orders', async (req) => {
    const user = requireUser(req);
    const q = parse(
      z.object({
        status: z.enum(['open', 'all']).default('all'),
        ticker: z.string().regex(/^[A-Za-z]{1,8}$/).transform((s) => s.toUpperCase()).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        beforeSeq: z.coerce.number().int().min(1).optional(),
      }),
      req.query,
    );
    return { orders: await listOrders(pool, user.id, q) };
  });

  app.get('/orders/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(uuidParam, req.params);
    return { order: await getOrder(pool, user.id, id) };
  });
}
