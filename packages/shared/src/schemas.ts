import { z } from 'zod';

/** Hard limits enforced on every order (server side). */
export const LIMITS = Object.freeze({
  MAX_ORDER_QUANTITY: 1_000_000,
  /** $1,000,000.00 per share */
  MAX_PRICE_CENTS: 100_000_000,
  /** $100,000,000.00 */
  MAX_NOTIONAL_CENTS: 10_000_000_000,
});

export const tickerSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{1,8}$/, 'Invalid ticker'));

export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_]{3,32}$/, 'Username must be 3-32 characters: letters, digits, underscore');

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters');

export const registerSchema = z.object({ username: usernameSchema, password: passwordSchema }).strict();
export const loginSchema = z
  .object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(128) })
  .strict();

export const orderSideSchema = z.enum(['BUY', 'SELL']);
export const orderTypeSchema = z.enum(['MARKET', 'LIMIT']);

const intIn = (min: number, max: number) => z.number().int().min(min).max(max);

/**
 * Place-order request. Prices are integer cents.
 *  - LIMIT orders require limitPriceCents and must not send maxSpendCents.
 *  - MARKET BUY requires maxSpendCents (server-enforced budget).
 *  - MARKET SELL must not send limitPriceCents / maxSpendCents.
 */
export const placeOrderSchema = z
  .object({
    ticker: tickerSchema,
    side: orderSideSchema,
    type: orderTypeSchema,
    quantity: intIn(1, LIMITS.MAX_ORDER_QUANTITY),
    limitPriceCents: intIn(1, LIMITS.MAX_PRICE_CENTS).optional(),
    maxSpendCents: intIn(1, LIMITS.MAX_NOTIONAL_CENTS).optional(),
  })
  .strict()
  .superRefine((o, ctx) => {
    if (o.type === 'LIMIT') {
      if (o.limitPriceCents === undefined)
        ctx.addIssue({ code: 'custom', path: ['limitPriceCents'], message: 'LIMIT orders require limitPriceCents' });
      if (o.maxSpendCents !== undefined)
        ctx.addIssue({ code: 'custom', path: ['maxSpendCents'], message: 'maxSpendCents applies to MARKET BUY only' });
    } else {
      if (o.limitPriceCents !== undefined)
        ctx.addIssue({ code: 'custom', path: ['limitPriceCents'], message: 'MARKET orders must not have a limit price' });
      if (o.side === 'BUY' && o.maxSpendCents === undefined)
        ctx.addIssue({ code: 'custom', path: ['maxSpendCents'], message: 'MARKET BUY requires maxSpendCents' });
      if (o.side === 'SELL' && o.maxSpendCents !== undefined)
        ctx.addIssue({ code: 'custom', path: ['maxSpendCents'], message: 'maxSpendCents applies to MARKET BUY only' });
    }
  });
export type PlaceOrderRequest = z.infer<typeof placeOrderSchema>;

export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_\-:.]{8,128}$/, 'Idempotency-Key must be 8-128 chars of [A-Za-z0-9_-:.]');

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().min(1).optional(),
});

export const historyQuerySchema = z.object({
  interval: z.enum(['trade', '1m', '5m', '15m', '1h', '1d']).default('trade'),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export const securityStatusSchema = z.enum(['ACTIVE', 'HALTED', 'SUSPENDED', 'UNLISTED']);

/* ----------------------------- Admin requests ----------------------------- */

export const haltRequestSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

export const adminCreateUserSchema = z
  .object({ username: usernameSchema, password: passwordSchema, role: z.enum(['USER', 'ADMIN']).default('USER') })
  .strict();

export const adminUpdateUserSchema = z
  .object({
    role: z.enum(['USER', 'ADMIN']).optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    password: passwordSchema.optional(),
  })
  .strict();

export const listingStatusChangeSchema = z
  .object({
    status: securityStatusSchema,
    reason: z.string().trim().min(3).max(1000),
    /** Reference to the documented authorization (e.g. "Exec board vote 2026-11-20, minutes item 4"). */
    authorizationReference: z.string().trim().min(3).max(500),
  })
  .strict();

export const SIMULATION_ACKNOWLEDGEMENT = 'I UNDERSTAND THIS PRICE IS SIMULATED AND NOT ORIGINAL';

export const simulatedReferenceSchema = z
  .object({
    referencePriceCents: intIn(1, LIMITS.MAX_PRICE_CENTS),
    /** Also mark the listing ACTIVE (simulation) so it can trade. */
    activate: z.boolean().default(false),
    note: z.string().trim().min(3).max(1000),
    acknowledgement: z.literal(SIMULATION_ACKNOWLEDGEMENT),
  })
  .strict();

export const liquidityLevelSchema = z
  .object({ offsetBps: z.number().int().min(-5000).max(50000), quantity: intIn(1, LIMITS.MAX_ORDER_QUANTITY) })
  .strict();

export const marketMakerConfigSchema = z
  .object({
    inventoryShares: intIn(0, 10_000_000),
    askLevels: z.array(liquidityLevelSchema).max(20),
    bidLevels: z.array(liquidityLevelSchema).max(20),
    enabled: z.boolean().default(true),
    note: z.string().trim().min(3).max(1000),
  })
  .strict()
  .superRefine((c, ctx) => {
    const askQty = c.askLevels.reduce((a, l) => a + l.quantity, 0);
    if (askQty > c.inventoryShares)
      ctx.addIssue({ code: 'custom', path: ['askLevels'], message: 'Ask quantity exceeds inventoryShares' });
    if (c.bidLevels.some((l) => l.offsetBps >= 0))
      ctx.addIssue({ code: 'custom', path: ['bidLevels'], message: 'Bid offsets must be negative (below reference)' });
    if (c.askLevels.some((l) => l.offsetBps < 0))
      ctx.addIssue({ code: 'custom', path: ['askLevels'], message: 'Ask offsets must be >= 0 (at/above reference)' });
  });
export type MarketMakerConfigRequest = z.infer<typeof marketMakerConfigSchema>;

export const RESET_CONFIRMATION_PHRASE = 'RESET THE AEZ STOCK EXCHANGE SIMULATION';

export const simulationResetSchema = z
  .object({
    confirmation: z.literal(RESET_CONFIRMATION_PHRASE),
    password: z.string().min(1).max(128),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();

/* ------------------------------- UI support ------------------------------- */

export const portfolioRangeSchema = z.enum(['1D', '1W', '1M', 'ALL']);

export const newsPostSchema = z
  .object({
    ticker: tickerSchema.nullable().default(null),
    headline: z.string().trim().min(3).max(160),
    body: z.string().trim().max(4000).default(''),
  })
  .strict();
export type NewsPostRequest = z.infer<typeof newsPostSchema>;

export const newsVisibilitySchema = z.object({ hidden: z.boolean() }).strict();

export const WATCHLIST_MAX = 45;
