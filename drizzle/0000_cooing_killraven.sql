CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"name" text,
	"asset_class" text DEFAULT 'crypto' NOT NULL,
	"cc_symbol" text,
	"binance_pair" text,
	"track_price" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "assets_symbol_unique" UNIQUE("symbol"),
	CONSTRAINT "asset_class_check" CHECK ("assets"."asset_class" IN ('crypto','stable','fiat'))
);
--> statement-breakpoint
CREATE TABLE "daily_prices" (
	"asset_id" integer NOT NULL,
	"price_date" date NOT NULL,
	"close_usd" numeric(20, 8) NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "daily_prices_asset_id_price_date_pk" PRIMARY KEY("asset_id","price_date")
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"rate_date" date PRIMARY KEY NOT NULL,
	"ttm" numeric(10, 4) NOT NULL,
	"ttb" numeric(10, 4),
	"tts" numeric(10, 4),
	"source" text DEFAULT 'mizuho' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"filename" text,
	"row_count" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"tx_type" text NOT NULL,
	"base_asset_id" integer NOT NULL,
	"base_qty" numeric(30, 12) NOT NULL,
	"quote_asset_id" integer,
	"quote_qty" numeric(30, 12),
	"price_usd" numeric(20, 8),
	"usdjpy" numeric(10, 4),
	"jpy_value" numeric(20, 2),
	"price_source" text,
	"fee_asset_id" integer,
	"fee_qty" numeric(30, 12),
	"venue" text,
	"tx_hash" text,
	"memo" text,
	"import_batch_id" bigint,
	"row_hash" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "tx_type_check" CHECK ("transactions"."tx_type" IN ('buy','sell','swap','reward','fee','transfer_in','transfer_out')),
	CONSTRAINT "base_qty_positive_check" CHECK ("transactions"."base_qty" > 0),
	CONSTRAINT "quote_qty_positive_check" CHECK ("transactions"."quote_qty" IS NULL OR "transactions"."quote_qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "daily_prices" ADD CONSTRAINT "daily_prices_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_base_asset_id_assets_id_fk" FOREIGN KEY ("base_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_quote_asset_id_assets_id_fk" FOREIGN KEY ("quote_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_fee_asset_id_assets_id_fk" FOREIGN KEY ("fee_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_tx_row_hash" ON "transactions" USING btree ("row_hash") WHERE "transactions"."row_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_tx_asset_time" ON "transactions" USING btree ("base_asset_id","executed_at");--> statement-breakpoint
CREATE INDEX "idx_tx_time" ON "transactions" USING btree ("executed_at");