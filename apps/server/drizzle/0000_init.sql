CREATE TYPE "public"."account_type" AS ENUM('HUMAN', 'MARKET_MAKER');--> statement-breakpoint
CREATE TYPE "public"."cash_ledger_reason" AS ENUM('INITIAL_GRANT', 'MARKET_MAKER_FUNDING', 'TRADE_BUY', 'TRADE_SELL');--> statement-breakpoint
CREATE TYPE "public"."security_data_source" AS ENUM('VERIFIED_IMPORT', 'ADMIN_AUTHORIZED', 'ADMIN_SIMULATION');--> statement-breakpoint
CREATE TYPE "public"."halt_scope" AS ENUM('MARKET', 'SYMBOL');--> statement-breakpoint
CREATE TYPE "public"."order_side" AS ENUM('BUY', 'SELL');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('MARKET', 'LIMIT');--> statement-breakpoint
CREATE TYPE "public"."position_ledger_reason" AS ENUM('ISSUANCE', 'TRADE_BUY', 'TRADE_SELL');--> statement-breakpoint
CREATE TYPE "public"."security_status" AS ENUM('ACTIVE', 'HALTED', 'SUSPENDED', 'UNLISTED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('USER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE SEQUENCE "public"."order_acceptance_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"cash_cents" bigint NOT NULL,
	"reserved_cents" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_nonneg" CHECK ("cash_accounts"."cash_cents" >= 0),
	CONSTRAINT "cash_reserved_nonneg" CHECK ("cash_accounts"."reserved_cents" >= 0),
	CONSTRAINT "cash_reserved_le_cash" CHECK ("cash_accounts"."reserved_cents" <= "cash_accounts"."cash_cents")
);
--> statement-breakpoint
CREATE TABLE "cash_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"balance_after_cents" bigint NOT NULL,
	"reason" "cash_ledger_reason" NOT NULL,
	"trade_id" bigint,
	"order_id" uuid,
	"epoch" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_ledger_nonzero" CHECK ("cash_ledger"."amount_cents" <> 0),
	CONSTRAINT "cash_ledger_balance_nonneg" CHECK ("cash_ledger"."balance_after_cents" >= 0),
	CONSTRAINT "cash_ledger_trade_ref" CHECK (("cash_ledger"."reason" IN ('TRADE_BUY', 'TRADE_SELL')) = ("cash_ledger"."trade_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"user_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"quantity" bigint DEFAULT 0 NOT NULL,
	"reserved_quantity" bigint DEFAULT 0 NOT NULL,
	"cost_basis_cents" bigint DEFAULT 0 NOT NULL,
	"realized_pnl_cents" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holdings_user_id_ticker_pk" PRIMARY KEY("user_id","ticker"),
	CONSTRAINT "holdings_qty_nonneg" CHECK ("holdings"."quantity" >= 0),
	CONSTRAINT "holdings_reserved_nonneg" CHECK ("holdings"."reserved_quantity" >= 0),
	CONSTRAINT "holdings_reserved_le_qty" CHECK ("holdings"."reserved_quantity" <= "holdings"."quantity"),
	CONSTRAINT "holdings_basis_nonneg" CHECK ("holdings"."cost_basis_cents" >= 0),
	CONSTRAINT "holdings_zero_basis_when_flat" CHECK ("holdings"."quantity" > 0 OR "holdings"."cost_basis_cents" = 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"scope" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "market_maker_configs" (
	"ticker" text PRIMARY KEY NOT NULL,
	"inventory_shares" bigint NOT NULL,
	"ask_levels" jsonb NOT NULL,
	"bid_levels" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"note" text NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_epoch" integer,
	"opened_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mm_inventory_nonneg" CHECK ("market_maker_configs"."inventory_shares" >= 0)
);
--> statement-breakpoint
CREATE TABLE "market_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"current_epoch" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_state_singleton" CHECK ("market_state"."id" = 1),
	CONSTRAINT "market_state_epoch_pos" CHECK ("market_state"."current_epoch" >= 1)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint DEFAULT nextval('order_acceptance_seq') NOT NULL,
	"user_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"side" "order_side" NOT NULL,
	"type" "order_type" NOT NULL,
	"limit_price_cents" bigint,
	"quantity" bigint NOT NULL,
	"filled_quantity" bigint DEFAULT 0 NOT NULL,
	"max_spend_cents" bigint,
	"reserved_cents" bigint DEFAULT 0 NOT NULL,
	"reserved_quantity" bigint DEFAULT 0 NOT NULL,
	"filled_notional_cents" bigint DEFAULT 0 NOT NULL,
	"status" "order_status" NOT NULL,
	"reject_reason" text,
	"cancel_reason" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "orders_qty_pos" CHECK ("orders"."quantity" > 0),
	CONSTRAINT "orders_filled_range" CHECK ("orders"."filled_quantity" >= 0 AND "orders"."filled_quantity" <= "orders"."quantity"),
	CONSTRAINT "orders_limit_price_shape" CHECK (("orders"."type" = 'LIMIT' AND "orders"."limit_price_cents" IS NOT NULL AND "orders"."limit_price_cents" > 0) OR ("orders"."type" = 'MARKET' AND "orders"."limit_price_cents" IS NULL)),
	CONSTRAINT "orders_max_spend_shape" CHECK (("orders"."type" = 'MARKET' AND "orders"."side" = 'BUY' AND "orders"."max_spend_cents" IS NOT NULL AND "orders"."max_spend_cents" > 0) OR (NOT ("orders"."type" = 'MARKET' AND "orders"."side" = 'BUY') AND "orders"."max_spend_cents" IS NULL)),
	CONSTRAINT "orders_market_never_rests" CHECK (NOT ("orders"."type" = 'MARKET' AND "orders"."status" IN ('OPEN', 'PARTIALLY_FILLED'))),
	CONSTRAINT "orders_status_fill_consistent" CHECK (("orders"."status" = 'FILLED' AND "orders"."filled_quantity" = "orders"."quantity")
        OR ("orders"."status" = 'OPEN' AND "orders"."filled_quantity" = 0)
        OR ("orders"."status" = 'PARTIALLY_FILLED' AND "orders"."filled_quantity" > 0 AND "orders"."filled_quantity" < "orders"."quantity")
        OR ("orders"."status" = 'CANCELLED' AND "orders"."filled_quantity" < "orders"."quantity")
        OR ("orders"."status" = 'REJECTED' AND "orders"."filled_quantity" = 0)),
	CONSTRAINT "orders_reservation_only_when_resting" CHECK ("orders"."reserved_cents" >= 0 AND "orders"."reserved_quantity" >= 0 AND ("orders"."status" IN ('OPEN', 'PARTIALLY_FILLED') OR ("orders"."reserved_cents" = 0 AND "orders"."reserved_quantity" = 0))),
	CONSTRAINT "orders_reservation_side" CHECK (("orders"."side" = 'BUY' AND "orders"."reserved_quantity" = 0) OR ("orders"."side" = 'SELL' AND "orders"."reserved_cents" = 0)),
	CONSTRAINT "orders_notional_nonneg" CHECK ("orders"."filled_notional_cents" >= 0),
	CONSTRAINT "orders_closed_at_consistent" CHECK (("orders"."status" IN ('OPEN', 'PARTIALLY_FILLED')) = ("orders"."closed_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"room" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"quantity_delta" bigint NOT NULL,
	"quantity_after" bigint NOT NULL,
	"reason" "position_ledger_reason" NOT NULL,
	"trade_id" bigint,
	"issuance_id" bigint,
	"epoch" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_ledger_nonzero" CHECK ("position_ledger"."quantity_delta" <> 0),
	CONSTRAINT "position_ledger_after_nonneg" CHECK ("position_ledger"."quantity_after" >= 0),
	CONSTRAINT "position_ledger_ref" CHECK (("position_ledger"."reason" = 'ISSUANCE' AND "position_ledger"."issuance_id" IS NOT NULL AND "position_ledger"."trade_id" IS NULL) OR ("position_ledger"."reason" IN ('TRADE_BUY', 'TRADE_SELL') AND "position_ledger"."trade_id" IS NOT NULL AND "position_ledger"."issuance_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"trade_id" bigint NOT NULL,
	"price_cents" bigint NOT NULL,
	"quantity" bigint NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "securities" (
	"ticker" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"original_rank" integer NOT NULL,
	"status" "security_status",
	"status_source" "security_data_source",
	"status_updated_at" timestamp with time zone,
	"reference_price_cents" bigint,
	"reference_price_source" "security_data_source",
	"reference_verified_at" timestamp with time zone,
	"reference_verified_by" text,
	"verification_source_ref" text,
	"trading_restriction" text,
	"last_price_cents" bigint,
	"last_trade_at" timestamp with time zone,
	"book_version" bigint DEFAULT 0 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"news" text,
	"background" text,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "securities_ticker_format" CHECK ("securities"."ticker" ~ '^[A-Z]{1,8}$'),
	CONSTRAINT "securities_rank_pos" CHECK ("securities"."original_rank" > 0),
	CONSTRAINT "securities_ref_price_pos" CHECK ("securities"."reference_price_cents" IS NULL OR "securities"."reference_price_cents" > 0),
	CONSTRAINT "securities_last_price_pos" CHECK ("securities"."last_price_cents" IS NULL OR "securities"."last_price_cents" > 0),
	CONSTRAINT "securities_ref_source_consistent" CHECK (("securities"."reference_price_cents" IS NULL) = ("securities"."reference_price_source" IS NULL)),
	CONSTRAINT "securities_status_source_consistent" CHECK (("securities"."status" IS NULL) = ("securities"."status_source" IS NULL)),
	CONSTRAINT "securities_book_version_nonneg" CHECK ("securities"."book_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "security_history_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"ordinal" integer NOT NULL,
	"change_bps" integer,
	"note" text,
	"kind" text DEFAULT 'HISTORICAL_ASSIGNMENT_ANNOTATION' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_issuance" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"epoch" integer NOT NULL,
	"ticker" text NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"reason" text NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issuance_qty_pos" CHECK ("security_issuance"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "sessions_id_format" CHECK ("sessions"."id" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "simulation_resets" (
	"id" serial PRIMARY KEY NOT NULL,
	"previous_epoch" integer NOT NULL,
	"new_epoch" integer NOT NULL,
	"performed_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"price_cents" bigint NOT NULL,
	"quantity" bigint NOT NULL,
	"buy_order_id" uuid NOT NULL,
	"sell_order_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"maker_order_id" uuid NOT NULL,
	"taker_order_id" uuid NOT NULL,
	"aggressor_side" "order_side" NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trades_price_pos" CHECK ("trades"."price_cents" > 0),
	CONSTRAINT "trades_qty_pos" CHECK ("trades"."quantity" > 0),
	CONSTRAINT "trades_no_self_trade" CHECK ("trades"."buyer_id" <> "trades"."seller_id"),
	CONSTRAINT "trades_maker_taker" CHECK (("trades"."maker_order_id" = "trades"."buy_order_id" AND "trades"."taker_order_id" = "trades"."sell_order_id" AND "trades"."aggressor_side" = 'SELL')
        OR ("trades"."maker_order_id" = "trades"."sell_order_id" AND "trades"."taker_order_id" = "trades"."buy_order_id" AND "trades"."aggressor_side" = 'BUY'))
);
--> statement-breakpoint
CREATE TABLE "trading_halts" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" "halt_scope" NOT NULL,
	"ticker" text,
	"reason" text NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_by" uuid,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	CONSTRAINT "halts_scope_ticker" CHECK (("trading_halts"."scope" = 'MARKET') = ("trading_halts"."ticker" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text,
	"role" "user_role" DEFAULT 'USER' NOT NULL,
	"account_type" "account_type" DEFAULT 'HUMAN' NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_username_format" CHECK ("users"."username" ~ '^[A-Za-z0-9_]{3,32}$'),
	CONSTRAINT "users_login_capability" CHECK (("users"."account_type" = 'MARKET_MAKER' AND "users"."password_hash" IS NULL AND "users"."role" = 'USER') OR ("users"."account_type" = 'HUMAN' AND "users"."password_hash" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_ledger" ADD CONSTRAINT "cash_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_ledger" ADD CONSTRAINT "cash_ledger_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_ledger" ADD CONSTRAINT "cash_ledger_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_ticker_securities_ticker_fk" FOREIGN KEY ("ticker") REFERENCES "public"."securities"("ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_maker_configs" ADD CONSTRAINT "market_maker_configs_ticker_securities_ticker_fk" FOREIGN KEY ("ticker") REFERENCES "public"."securities"("ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_maker_configs" ADD CONSTRAINT "market_maker_configs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_ticker_securities_ticker_fk" FOREIGN KEY ("ticker") REFERENCES "public"."securities"("ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_ledger" ADD CONSTRAINT "position_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_ledger" ADD CONSTRAINT "position_ledger_ticker_securities_ticker_fk" FOREIGN KEY ("ticker") REFERENCES "public"."securities"("ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_ledger" ADD CONSTRAINT "position_ledger_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_ledger" ADD CONSTRAINT "position_ledger_issuance_id_security_issuance_id_fk" FOREIGN KEY ("issuance_id") REFERENCES "public"."security_issuance"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_ticker_securities_ticker_fk" FOREIGN KEY ("ticker") REFERENCES "public"."securities"("ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_history_notes" ADD CONSTRAINT "security_history_notes_ticker_securities_ticker_fk" FOREIGN KEY ("ticker") REFERENCES "public"."securities"("ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_issuance" ADD CONSTRAINT "security_issuance_ticker_securities_ticker_fk" FOREIGN KEY ("ticker") REFERENCES "public"."securities"("ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_issuance" ADD CONSTRAINT "security_issuance_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_issuance" ADD CONSTRAINT "security_issuance_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_resets" ADD CONSTRAINT "simulation_resets_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_ticker_securities_ticker_fk" FOREIGN KEY ("ticker") REFERENCES "public"."securities"("ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_buy_order_id_orders_id_fk" FOREIGN KEY ("buy_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_sell_order_id_orders_id_fk" FOREIGN KEY ("sell_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_halts" ADD CONSTRAINT "trading_halts_ticker_securities_ticker_fk" FOREIGN KEY ("ticker") REFERENCES "public"."securities"("ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_halts" ADD CONSTRAINT "trading_halts_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_halts" ADD CONSTRAINT "trading_halts_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "cash_ledger_user_idx" ON "cash_ledger" USING btree ("user_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "cash_ledger_trade_user_uq" ON "cash_ledger" USING btree ("trade_id","user_id");--> statement-breakpoint
CREATE INDEX "holdings_ticker_idx" ON "holdings" USING btree ("ticker");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_seq_uq" ON "orders" USING btree ("seq");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_user_idem_uq" ON "orders" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_book_bids_idx" ON "orders" USING btree ("ticker","limit_price_cents" DESC NULLS LAST,"seq") WHERE "orders"."side" = 'BUY' AND "orders"."status" IN ('OPEN', 'PARTIALLY_FILLED');--> statement-breakpoint
CREATE INDEX "orders_book_asks_idx" ON "orders" USING btree ("ticker","limit_price_cents","seq") WHERE "orders"."side" = 'SELL' AND "orders"."status" IN ('OPEN', 'PARTIALLY_FILLED');--> statement-breakpoint
CREATE INDEX "orders_user_open_idx" ON "orders" USING btree ("user_id","ticker") WHERE "orders"."status" IN ('OPEN', 'PARTIALLY_FILLED');--> statement-breakpoint
CREATE INDEX "orders_user_created_idx" ON "orders" USING btree ("user_id","seq" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox_events" USING btree ("id") WHERE "outbox_events"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "position_ledger_user_idx" ON "position_ledger" USING btree ("user_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "position_ledger_ticker_idx" ON "position_ledger" USING btree ("ticker");--> statement-breakpoint
CREATE UNIQUE INDEX "position_ledger_trade_user_uq" ON "position_ledger" USING btree ("trade_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_history_trade_uq" ON "price_history" USING btree ("trade_id");--> statement-breakpoint
CREATE INDEX "price_history_ticker_time_idx" ON "price_history" USING btree ("ticker","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "securities_rank_uq" ON "securities" USING btree ("original_rank");--> statement-breakpoint
CREATE UNIQUE INDEX "securities_name_uq" ON "securities" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "security_history_notes_uq" ON "security_history_notes" USING btree ("ticker","ordinal");--> statement-breakpoint
CREATE INDEX "security_issuance_ticker_idx" ON "security_issuance" USING btree ("ticker","epoch");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_order_pair_uq" ON "trades" USING btree ("buy_order_id","sell_order_id");--> statement-breakpoint
CREATE INDEX "trades_ticker_idx" ON "trades" USING btree ("ticker","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trades_ticker_time_idx" ON "trades" USING btree ("ticker","executed_at");--> statement-breakpoint
CREATE INDEX "trades_buyer_idx" ON "trades" USING btree ("buyer_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trades_seller_idx" ON "trades" USING btree ("seller_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "halts_one_active_market_uq" ON "trading_halts" USING btree ("scope") WHERE "trading_halts"."scope" = 'MARKET' AND "trading_halts"."ended_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "halts_one_active_symbol_uq" ON "trading_halts" USING btree ("ticker") WHERE "trading_halts"."scope" = 'SYMBOL' AND "trading_halts"."ended_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_uq" ON "users" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_single_market_maker_uq" ON "users" USING btree ("account_type") WHERE "users"."account_type" = 'MARKET_MAKER';