/**
 * Drizzle schema for the AEZ Stock Exchange.
 *
 * Conventions:
 *  - Money is BIGINT integer cents ("*_cents"). Never floating point.
 *  - Share quantities are BIGINT integers.
 *  - Every invariant that can be stated declaratively is a CHECK / UNIQUE / FK
 *    constraint so that a bug in application code fails loudly and rolls back
 *    instead of corrupting balances.
 *
 * This file must stay self-contained (no relative imports) because drizzle-kit
 * loads it directly.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const money = (name: string) => bigint(name, { mode: 'bigint' });
const qty = (name: string) => bigint(name, { mode: 'bigint' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/* --------------------------------- Enums --------------------------------- */

export const userRole = pgEnum('user_role', ['USER', 'ADMIN']);
/**
 * HUMAN: a person who logs in. MARKET_MAKER: the single system liquidity account.
 * SIMULATION: system "simulation desk" traders used only by the history
 * generator. Non-human accounts cannot log in and are never ranked.
 */
export const accountType = pgEnum('account_type', ['HUMAN', 'MARKET_MAKER', 'SIMULATION']);
export const userStatus = pgEnum('user_status', ['ACTIVE', 'DISABLED']);
export const securityStatus = pgEnum('security_status', ['ACTIVE', 'HALTED', 'SUSPENDED', 'UNLISTED']);
/** Where a security's reference price / listing status came from. */
export const dataSource = pgEnum('security_data_source', ['VERIFIED_IMPORT', 'ADMIN_AUTHORIZED', 'ADMIN_SIMULATION']);
export const orderSide = pgEnum('order_side', ['BUY', 'SELL']);
export const orderType = pgEnum('order_type', ['MARKET', 'LIMIT']);
export const orderStatus = pgEnum('order_status', ['OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED']);
export const haltScope = pgEnum('halt_scope', ['MARKET', 'SYMBOL']);
export const cashLedgerReason = pgEnum('cash_ledger_reason', [
  'INITIAL_GRANT',
  'MARKET_MAKER_FUNDING',
  'TRADE_BUY',
  'TRADE_SELL',
]);
export const positionLedgerReason = pgEnum('position_ledger_reason', ['ISSUANCE', 'TRADE_BUY', 'TRADE_SELL']);

/** Monotonic order acceptance sequence: the time-priority tie breaker. */
export const orderAcceptanceSeq = pgSequence('order_acceptance_seq', { startWith: 1, increment: 1 });

/* ------------------------------ Market state ----------------------------- */

/**
 * Singleton row (id = 1). Order placement takes FOR SHARE on it; market-wide
 * halts and simulation resets take FOR UPDATE, which makes them serialize
 * cleanly against in-flight order transactions.
 */
export const marketState = pgTable(
  'market_state',
  {
    id: integer('id').primaryKey(),
    currentEpoch: integer('current_epoch').notNull().default(1),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [check('market_state_singleton', sql`${t.id} = 1`), check('market_state_epoch_pos', sql`${t.currentEpoch} >= 1`)],
);

/* --------------------------------- Users --------------------------------- */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    /** argon2id PHC string. NULL only for the system market-maker, which cannot log in. */
    passwordHash: text('password_hash'),
    role: userRole('role').notNull().default('USER'),
    accountType: accountType('account_type').notNull().default('HUMAN'),
    status: userStatus('status').notNull().default('ACTIVE'),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastLoginAt: ts('last_login_at'),
  },
  (t) => [
    uniqueIndex('users_username_lower_uq').on(sql`lower(${t.username})`),
    uniqueIndex('users_single_market_maker_uq').on(t.accountType).where(sql`${t.accountType} = 'MARKET_MAKER'`),
    check('users_username_format', sql`${t.username} ~ '^[A-Za-z0-9_]{3,32}$'`),
    check(
      'users_login_capability',
      // ::text so the migration that adds the SIMULATION enum value can create this in the same transaction.
      sql`(${t.accountType}::text IN ('MARKET_MAKER', 'SIMULATION') AND ${t.passwordHash} IS NULL AND ${t.role} = 'USER') OR (${t.accountType} = 'HUMAN' AND ${t.passwordHash} IS NOT NULL)`,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 (hex) of the random session token. The raw token is never stored. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId), check('sessions_id_format', sql`${t.id} ~ '^[0-9a-f]{64}$'`)],
);

/* ------------------------------- Securities ------------------------------ */

export const securities = pgTable(
  'securities',
  {
    ticker: text('ticker').primaryKey(),
    name: text('name').notNull(),
    originalRank: integer('original_rank').notNull(),
    /** NULL = unknown / unverified -> non-tradable until reconciled. */
    status: securityStatus('status'),
    statusSource: dataSource('status_source'),
    statusUpdatedAt: ts('status_updated_at'),
    /** Verified (or explicitly simulated) starting reference price. NULL until imported. */
    referencePriceCents: money('reference_price_cents'),
    referencePriceSource: dataSource('reference_price_source'),
    referenceVerifiedAt: ts('reference_verified_at'),
    referenceVerifiedBy: text('reference_verified_by'),
    verificationSourceRef: text('verification_source_ref'),
    tradingRestriction: text('trading_restriction'),
    /** Updated ONLY by genuine matched executions. */
    lastPriceCents: money('last_price_cents'),
    lastTradeAt: ts('last_trade_at'),
    /** Incremented on every order-book change; lets clients detect missed book events. */
    bookVersion: bigint('book_version', { mode: 'bigint' }).notNull().default(sql`0`),
    description: text('description').notNull().default(''),
    news: text('news'),
    background: text('background'),
    imageUrl: text('image_url'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('securities_rank_uq').on(t.originalRank),
    uniqueIndex('securities_name_uq').on(t.name),
    check('securities_ticker_format', sql`${t.ticker} ~ '^[A-Z]{1,8}$'`),
    check('securities_rank_pos', sql`${t.originalRank} > 0`),
    check('securities_ref_price_pos', sql`${t.referencePriceCents} IS NULL OR ${t.referencePriceCents} > 0`),
    check('securities_last_price_pos', sql`${t.lastPriceCents} IS NULL OR ${t.lastPriceCents} > 0`),
    check(
      'securities_ref_source_consistent',
      sql`(${t.referencePriceCents} IS NULL) = (${t.referencePriceSource} IS NULL)`,
    ),
    check('securities_status_source_consistent', sql`(${t.status} IS NULL) = (${t.statusSource} IS NULL)`),
    check('securities_book_version_nonneg', sql`${t.bookVersion} >= 0`),
  ],
);

export const securityHistoryNotes = pgTable(
  'security_history_notes',
  {
    id: serial('id').primaryKey(),
    ticker: text('ticker')
      .notNull()
      .references(() => securities.ticker),
    ordinal: integer('ordinal').notNull(),
    /** Basis points (1% = 100). Annotation only; never executed as a trade. */
    changeBps: integer('change_bps'),
    note: text('note'),
    kind: text('kind').notNull().default('HISTORICAL_ASSIGNMENT_ANNOTATION'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('security_history_notes_uq').on(t.ticker, t.ordinal)],
);

/* --------------------------- Cash and holdings --------------------------- */

export const cashAccounts = pgTable(
  'cash_accounts',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id),
    /** Settled cash. */
    cashCents: money('cash_cents').notNull(),
    /** Cash reserved by resting limit buys. available = cash - reserved. */
    reservedCents: money('reserved_cents').notNull().default(sql`0`),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('cash_nonneg', sql`${t.cashCents} >= 0`),
    check('cash_reserved_nonneg', sql`${t.reservedCents} >= 0`),
    check('cash_reserved_le_cash', sql`${t.reservedCents} <= ${t.cashCents}`),
  ],
);

export const holdings = pgTable(
  'holdings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    ticker: text('ticker')
      .notNull()
      .references(() => securities.ticker),
    quantity: qty('quantity').notNull().default(sql`0`),
    /** Shares reserved by resting limit sells. available = quantity - reserved. */
    reservedQuantity: qty('reserved_quantity').notNull().default(sql`0`),
    /** Average-cost basis of the shares currently held. */
    costBasisCents: money('cost_basis_cents').notNull().default(sql`0`),
    realizedPnlCents: money('realized_pnl_cents').notNull().default(sql`0`),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.ticker] }),
    index('holdings_ticker_idx').on(t.ticker),
    check('holdings_qty_nonneg', sql`${t.quantity} >= 0`),
    check('holdings_reserved_nonneg', sql`${t.reservedQuantity} >= 0`),
    check('holdings_reserved_le_qty', sql`${t.reservedQuantity} <= ${t.quantity}`),
    check('holdings_basis_nonneg', sql`${t.costBasisCents} >= 0`),
    check('holdings_zero_basis_when_flat', sql`${t.quantity} > 0 OR ${t.costBasisCents} = 0`),
  ],
);

/* --------------------------------- Orders -------------------------------- */

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Monotonic acceptance sequence (time priority). Assigned while holding the symbol lock. */
    seq: bigint('seq', { mode: 'bigint' })
      .notNull()
      .default(sql`nextval('order_acceptance_seq')`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    ticker: text('ticker')
      .notNull()
      .references(() => securities.ticker),
    side: orderSide('side').notNull(),
    type: orderType('type').notNull(),
    limitPriceCents: money('limit_price_cents'),
    quantity: qty('quantity').notNull(),
    filledQuantity: qty('filled_quantity').notNull().default(sql`0`),
    /** MARKET BUY budget. */
    maxSpendCents: money('max_spend_cents'),
    /** Cash still reserved by this (resting) buy order. */
    reservedCents: money('reserved_cents').notNull().default(sql`0`),
    /** Shares still reserved by this (resting) sell order. */
    reservedQuantity: qty('reserved_quantity').notNull().default(sql`0`),
    /** Sum of price*qty over fills (paid for buys, received for sells). */
    filledNotionalCents: money('filled_notional_cents').notNull().default(sql`0`),
    status: orderStatus('status').notNull(),
    rejectReason: text('reject_reason'),
    cancelReason: text('cancel_reason'),
    idempotencyKey: text('idempotency_key'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    closedAt: ts('closed_at'),
  },
  (t) => [
    uniqueIndex('orders_seq_uq').on(t.seq),
    uniqueIndex('orders_user_idem_uq').on(t.userId, t.idempotencyKey),
    // Price-time priority indexes (partial: only resting orders).
    index('orders_book_bids_idx')
      .on(t.ticker, t.limitPriceCents.desc(), t.seq.asc())
      .where(sql`${t.side} = 'BUY' AND ${t.status} IN ('OPEN', 'PARTIALLY_FILLED')`),
    index('orders_book_asks_idx')
      .on(t.ticker, t.limitPriceCents.asc(), t.seq.asc())
      .where(sql`${t.side} = 'SELL' AND ${t.status} IN ('OPEN', 'PARTIALLY_FILLED')`),
    index('orders_user_open_idx')
      .on(t.userId, t.ticker)
      .where(sql`${t.status} IN ('OPEN', 'PARTIALLY_FILLED')`),
    index('orders_user_created_idx').on(t.userId, t.seq.desc()),
    check('orders_qty_pos', sql`${t.quantity} > 0`),
    check('orders_filled_range', sql`${t.filledQuantity} >= 0 AND ${t.filledQuantity} <= ${t.quantity}`),
    check(
      'orders_limit_price_shape',
      sql`(${t.type} = 'LIMIT' AND ${t.limitPriceCents} IS NOT NULL AND ${t.limitPriceCents} > 0) OR (${t.type} = 'MARKET' AND ${t.limitPriceCents} IS NULL)`,
    ),
    check(
      'orders_max_spend_shape',
      sql`(${t.type} = 'MARKET' AND ${t.side} = 'BUY' AND ${t.maxSpendCents} IS NOT NULL AND ${t.maxSpendCents} > 0) OR (NOT (${t.type} = 'MARKET' AND ${t.side} = 'BUY') AND ${t.maxSpendCents} IS NULL)`,
    ),
    check(
      'orders_market_never_rests',
      sql`NOT (${t.type} = 'MARKET' AND ${t.status} IN ('OPEN', 'PARTIALLY_FILLED'))`,
    ),
    check(
      'orders_status_fill_consistent',
      sql`(${t.status} = 'FILLED' AND ${t.filledQuantity} = ${t.quantity})
        OR (${t.status} = 'OPEN' AND ${t.filledQuantity} = 0)
        OR (${t.status} = 'PARTIALLY_FILLED' AND ${t.filledQuantity} > 0 AND ${t.filledQuantity} < ${t.quantity})
        OR (${t.status} = 'CANCELLED' AND ${t.filledQuantity} < ${t.quantity})
        OR (${t.status} = 'REJECTED' AND ${t.filledQuantity} = 0)`,
    ),
    check(
      'orders_reservation_only_when_resting',
      sql`${t.reservedCents} >= 0 AND ${t.reservedQuantity} >= 0 AND (${t.status} IN ('OPEN', 'PARTIALLY_FILLED') OR (${t.reservedCents} = 0 AND ${t.reservedQuantity} = 0))`,
    ),
    check(
      'orders_reservation_side',
      sql`(${t.side} = 'BUY' AND ${t.reservedQuantity} = 0) OR (${t.side} = 'SELL' AND ${t.reservedCents} = 0)`,
    ),
    check('orders_notional_nonneg', sql`${t.filledNotionalCents} >= 0`),
    check(
      'orders_closed_at_consistent',
      sql`(${t.status} IN ('OPEN', 'PARTIALLY_FILLED')) = (${t.closedAt} IS NULL)`,
    ),
  ],
);

/* ------------------------------- Executions ------------------------------ */

export const trades = pgTable(
  'trades',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    ticker: text('ticker')
      .notNull()
      .references(() => securities.ticker),
    priceCents: money('price_cents').notNull(),
    quantity: qty('quantity').notNull(),
    buyOrderId: uuid('buy_order_id')
      .notNull()
      .references(() => orders.id),
    sellOrderId: uuid('sell_order_id')
      .notNull()
      .references(() => orders.id),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id),
    makerOrderId: uuid('maker_order_id').notNull(),
    takerOrderId: uuid('taker_order_id').notNull(),
    aggressorSide: orderSide('aggressor_side').notNull(),
    /** Seller's realized P&L on this fill (proceeds minus average-cost basis removed). NULL only for pre-0002 rows. */
    sellerRealizedPnlCents: money('seller_realized_pnl_cents'),
    executedAt: ts('executed_at').notNull().defaultNow(),
  },
  (t) => [
    // A given pair of orders can only ever match once: duplicate executions are impossible.
    uniqueIndex('trades_order_pair_uq').on(t.buyOrderId, t.sellOrderId),
    index('trades_ticker_idx').on(t.ticker, t.id.desc()),
    index('trades_ticker_time_idx').on(t.ticker, t.executedAt),
    index('trades_buyer_idx').on(t.buyerId, t.id.desc()),
    index('trades_seller_idx').on(t.sellerId, t.id.desc()),
    check('trades_price_pos', sql`${t.priceCents} > 0`),
    check('trades_qty_pos', sql`${t.quantity} > 0`),
    check('trades_no_self_trade', sql`${t.buyerId} <> ${t.sellerId}`),
    check(
      'trades_maker_taker',
      sql`(${t.makerOrderId} = ${t.buyOrderId} AND ${t.takerOrderId} = ${t.sellOrderId} AND ${t.aggressorSide} = 'SELL')
        OR (${t.makerOrderId} = ${t.sellOrderId} AND ${t.takerOrderId} = ${t.buyOrderId} AND ${t.aggressorSide} = 'BUY')`,
    ),
  ],
);

/* -------------------------------- Ledgers -------------------------------- */

export const cashLedger = pgTable(
  'cash_ledger',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    amountCents: money('amount_cents').notNull(),
    balanceAfterCents: money('balance_after_cents').notNull(),
    reason: cashLedgerReason('reason').notNull(),
    tradeId: bigint('trade_id', { mode: 'bigint' }).references(() => trades.id),
    orderId: uuid('order_id').references(() => orders.id),
    epoch: integer('epoch').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('cash_ledger_user_idx').on(t.userId, t.id.desc()),
    uniqueIndex('cash_ledger_trade_user_uq').on(t.tradeId, t.userId),
    check('cash_ledger_nonzero', sql`${t.amountCents} <> 0`),
    check('cash_ledger_balance_nonneg', sql`${t.balanceAfterCents} >= 0`),
    check(
      'cash_ledger_trade_ref',
      sql`(${t.reason} IN ('TRADE_BUY', 'TRADE_SELL')) = (${t.tradeId} IS NOT NULL)`,
    ),
  ],
);

export const securityIssuance = pgTable(
  'security_issuance',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    epoch: integer('epoch').notNull(),
    ticker: text('ticker')
      .notNull()
      .references(() => securities.ticker),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => users.id),
    quantity: qty('quantity').notNull(),
    reason: text('reason').notNull(),
    approvedBy: uuid('approved_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('security_issuance_ticker_idx').on(t.ticker, t.epoch), check('issuance_qty_pos', sql`${t.quantity} > 0`)],
);

export const positionLedger = pgTable(
  'position_ledger',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    ticker: text('ticker')
      .notNull()
      .references(() => securities.ticker),
    quantityDelta: qty('quantity_delta').notNull(),
    quantityAfter: qty('quantity_after').notNull(),
    reason: positionLedgerReason('reason').notNull(),
    tradeId: bigint('trade_id', { mode: 'bigint' }).references(() => trades.id),
    issuanceId: bigint('issuance_id', { mode: 'bigint' }).references(() => securityIssuance.id),
    epoch: integer('epoch').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('position_ledger_user_idx').on(t.userId, t.id.desc()),
    index('position_ledger_ticker_idx').on(t.ticker),
    uniqueIndex('position_ledger_trade_user_uq').on(t.tradeId, t.userId),
    check('position_ledger_nonzero', sql`${t.quantityDelta} <> 0`),
    check('position_ledger_after_nonneg', sql`${t.quantityAfter} >= 0`),
    check(
      'position_ledger_ref',
      sql`(${t.reason} = 'ISSUANCE' AND ${t.issuanceId} IS NOT NULL AND ${t.tradeId} IS NULL) OR (${t.reason} IN ('TRADE_BUY', 'TRADE_SELL') AND ${t.tradeId} IS NOT NULL AND ${t.issuanceId} IS NULL)`,
    ),
  ],
);

/* ------------------------------ Price history ---------------------------- */

/** One row per genuine execution. Never synthesized. */
export const priceHistory = pgTable(
  'price_history',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    ticker: text('ticker')
      .notNull()
      .references(() => securities.ticker),
    tradeId: bigint('trade_id', { mode: 'bigint' })
      .notNull()
      .references(() => trades.id),
    priceCents: money('price_cents').notNull(),
    quantity: qty('quantity').notNull(),
    recordedAt: ts('recorded_at').notNull(),
  },
  (t) => [uniqueIndex('price_history_trade_uq').on(t.tradeId), index('price_history_ticker_time_idx').on(t.ticker, t.recordedAt)],
);

/* --------------------------- Market maker config ------------------------- */

export const marketMakerConfigs = pgTable(
  'market_maker_configs',
  {
    ticker: text('ticker')
      .primaryKey()
      .references(() => securities.ticker),
    /** Shares issued to the market maker when liquidity is opened (once per epoch). */
    inventoryShares: qty('inventory_shares').notNull(),
    /** [{ offsetBps, quantity }] relative to the reference price. */
    askLevels: jsonb('ask_levels').notNull(),
    bidLevels: jsonb('bid_levels').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    note: text('note').notNull(),
    approvedBy: uuid('approved_by')
      .notNull()
      .references(() => users.id),
    approvedAt: ts('approved_at').notNull().defaultNow(),
    openedEpoch: integer('opened_epoch'),
    openedAt: ts('opened_at'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [check('mm_inventory_nonneg', sql`${t.inventoryShares} >= 0`)],
);

/* --------------------------------- Halts --------------------------------- */

export const tradingHalts = pgTable(
  'trading_halts',
  {
    id: serial('id').primaryKey(),
    scope: haltScope('scope').notNull(),
    ticker: text('ticker').references(() => securities.ticker),
    reason: text('reason').notNull(),
    startedBy: uuid('started_by').references(() => users.id),
    startedAt: ts('started_at').notNull().defaultNow(),
    endedBy: uuid('ended_by').references(() => users.id),
    endedAt: ts('ended_at'),
    endReason: text('end_reason'),
  },
  (t) => [
    check('halts_scope_ticker', sql`(${t.scope} = 'MARKET') = (${t.ticker} IS NULL)`),
    uniqueIndex('halts_one_active_market_uq')
      .on(t.scope)
      .where(sql`${t.scope} = 'MARKET' AND ${t.endedAt} IS NULL`),
    uniqueIndex('halts_one_active_symbol_uq')
      .on(t.ticker)
      .where(sql`${t.scope} = 'SYMBOL' AND ${t.endedAt} IS NULL`),
  ],
);

/* ------------------------------ Idempotency ------------------------------ */

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    key: text('key').notNull(),
    scope: text('scope').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

/* --------------------------------- Audit --------------------------------- */

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    details: jsonb('details').notNull().default(sql`'{}'::jsonb`),
    ip: text('ip'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_logs_created_idx').on(t.createdAt), index('audit_logs_actor_idx').on(t.actorUserId)],
);

/* ------------------------------- Outbox ---------------------------------- */

/**
 * Transactional outbox. Rows are inserted in the same transaction as the state
 * change they describe, so an event exists iff the change committed. A relay
 * publishes them to Socket.IO after commit.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    event: text('event').notNull(),
    room: text('room').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    publishedAt: ts('published_at'),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [index('outbox_unpublished_idx').on(t.id).where(sql`${t.publishedAt} IS NULL`)],
);

/* --------------------------- Simulation resets --------------------------- */

export const simulationResets = pgTable('simulation_resets', {
  id: serial('id').primaryKey(),
  previousEpoch: integer('previous_epoch').notNull(),
  newEpoch: integer('new_epoch').notNull(),
  performedBy: uuid('performed_by')
    .notNull()
    .references(() => users.id),
  reason: text('reason').notNull(),
  summary: jsonb('summary').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/* ------------------------- Fictional news & watchlist --------------------- */

/** Fictional, parody-labeled AEZ market news. Never presented as real-world reporting. */
export const newsPosts = pgTable(
  'news_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** NULL = market-wide story. */
    ticker: text('ticker').references(() => securities.ticker),
    headline: text('headline').notNull(),
    body: text('body').notNull().default(''),
    /** Seed key for idempotent seeding of the default stories; NULL for admin-written posts. */
    seedKey: text('seed_key'),
    authorUserId: uuid('author_user_id').references(() => users.id),
    hidden: boolean('hidden').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('news_posts_created_idx').on(t.createdAt),
    index('news_posts_ticker_idx').on(t.ticker, t.createdAt),
    uniqueIndex('news_posts_seed_key_uq').on(t.seedKey),
    check('news_headline_len', sql`char_length(${t.headline}) BETWEEN 3 AND 160`),
    check('news_body_len', sql`char_length(${t.body}) <= 4000`),
  ],
);

export const watchlistItems = pgTable(
  'watchlist_items',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ticker: text('ticker')
      .notNull()
      .references(() => securities.ticker),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.ticker] })],
);
