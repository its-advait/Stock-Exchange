CREATE TABLE "news_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text,
	"headline" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"seed_key" text,
	"author_user_id" uuid,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_headline_len" CHECK (char_length("news_posts"."headline") BETWEEN 3 AND 160),
	CONSTRAINT "news_body_len" CHECK (char_length("news_posts"."body") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"user_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_items_user_id_ticker_pk" PRIMARY KEY("user_id","ticker")
);
--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "seller_realized_pnl_cents" bigint;--> statement-breakpoint
ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_ticker_securities_ticker_fk" FOREIGN KEY ("ticker") REFERENCES "public"."securities"("ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_ticker_securities_ticker_fk" FOREIGN KEY ("ticker") REFERENCES "public"."securities"("ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "news_posts_created_idx" ON "news_posts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "news_posts_ticker_idx" ON "news_posts" USING btree ("ticker","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "news_posts_seed_key_uq" ON "news_posts" USING btree ("seed_key");