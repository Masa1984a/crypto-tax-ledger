import { relations, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// 資産マスタ
export const assets = pgTable(
  "assets",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull().unique(),
    name: text("name"),
    assetClass: text("asset_class").notNull().default("crypto"),
    ccSymbol: text("cc_symbol"),
    binancePair: text("binance_pair"),
    trackPrice: boolean("track_price").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    check(
      "asset_class_check",
      sql`${table.assetClass} IN ('crypto','stable','fiat')`
    ),
  ]
);

// 日次終値(USD建て・UTC締め)
export const dailyPrices = pgTable(
  "daily_prices",
  {
    assetId: integer("asset_id")
      .notNull()
      .references(() => assets.id),
    priceDate: date("price_date").notNull(),
    closeUsd: numeric("close_usd", {
      precision: 20,
      scale: 8,
      mode: "string",
    }).notNull(),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.assetId, table.priceDate] })]
);

// USDJPY(みずほ TTM)
export const fxRates = pgTable("fx_rates", {
  rateDate: date("rate_date").primaryKey(),
  ttm: numeric("ttm", { precision: 10, scale: 4, mode: "string" }).notNull(),
  ttb: numeric("ttb", { precision: 10, scale: 4, mode: "string" }),
  tts: numeric("tts", { precision: 10, scale: 4, mode: "string" }),
  source: text("source").notNull().default("mizuho"),
});

// インポートバッチ
export const importBatches = pgTable("import_batches", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  filename: text("filename"),
  rowCount: integer("row_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// 取引台帳(コア)
export const transactions = pgTable(
  "transactions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
    txType: text("tx_type").notNull(),
    baseAssetId: integer("base_asset_id")
      .notNull()
      .references(() => assets.id),
    baseQty: numeric("base_qty", {
      precision: 30,
      scale: 12,
      mode: "string",
    }).notNull(),
    quoteAssetId: integer("quote_asset_id").references(() => assets.id),
    quoteQty: numeric("quote_qty", {
      precision: 30,
      scale: 12,
      mode: "string",
    }),
    priceUsd: numeric("price_usd", {
      precision: 20,
      scale: 8,
      mode: "string",
    }),
    usdjpy: numeric("usdjpy", { precision: 10, scale: 4, mode: "string" }),
    jpyValue: numeric("jpy_value", {
      precision: 20,
      scale: 2,
      mode: "string",
    }),
    priceSource: text("price_source"),
    feeAssetId: integer("fee_asset_id").references(() => assets.id),
    feeQty: numeric("fee_qty", { precision: 30, scale: 12, mode: "string" }),
    venue: text("venue"),
    txHash: text("tx_hash"),
    memo: text("memo"),
    // 資産の現在の保管場所(ステーキング先・ウォレット等)。venue(取引の実行場所・不変)とは別概念で、
    // 資産の移動に応じて自由に編集される可変タグ。税計算には影響しない。row_hashにも含めない。
    location: text("location"),
    importBatchId: bigint("import_batch_id", { mode: "number" }).references(
      () => importBatches.id
    ),
    rowHash: text("row_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    check(
      "tx_type_check",
      sql`${table.txType} IN ('buy','sell','swap','reward','fee','transfer_in','transfer_out')`
    ),
    check("base_qty_positive_check", sql`${table.baseQty} > 0`),
    check(
      "quote_qty_positive_check",
      sql`${table.quoteQty} IS NULL OR ${table.quoteQty} > 0`
    ),
    uniqueIndex("uniq_tx_row_hash")
      .on(table.rowHash)
      .where(sql`${table.rowHash} IS NOT NULL`),
    index("idx_tx_asset_time").on(table.baseAssetId, table.executedAt),
    index("idx_tx_time").on(table.executedAt),
  ]
);

export const transactionsRelations = relations(transactions, ({ one }) => ({
  baseAsset: one(assets, {
    fields: [transactions.baseAssetId],
    references: [assets.id],
    relationName: "baseAsset",
  }),
  quoteAsset: one(assets, {
    fields: [transactions.quoteAssetId],
    references: [assets.id],
    relationName: "quoteAsset",
  }),
  feeAsset: one(assets, {
    fields: [transactions.feeAssetId],
    references: [assets.id],
    relationName: "feeAsset",
  }),
  importBatch: one(importBatches, {
    fields: [transactions.importBatchId],
    references: [importBatches.id],
  }),
}));

export const importBatchesRelations = relations(importBatches, ({ many }) => ({
  transactions: many(transactions),
}));

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
export type DailyPrice = typeof dailyPrices.$inferSelect;
export type FxRate = typeof fxRates.$inferSelect;
export type ImportBatch = typeof importBatches.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

export const TX_TYPES = [
  "buy",
  "sell",
  "swap",
  "reward",
  "fee",
  "transfer_in",
  "transfer_out",
] as const;
export type TxType = (typeof TX_TYPES)[number];

export const ASSET_CLASSES = ["crypto", "stable", "fiat"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];
