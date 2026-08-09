// §5.2 正規CSVフォーマット(13列・ヘッダ行必須・UTF-8、BOM許容)
export const CANONICAL_CSV_COLUMNS = [
  "executed_at",
  "tx_type",
  "base_symbol",
  "base_qty",
  "quote_symbol",
  "quote_qty",
  "price_usd",
  "usdjpy",
  "fee_symbol",
  "fee_qty",
  "venue",
  "tx_hash",
  "memo",
] as const;

export type CanonicalColumn = (typeof CANONICAL_CSV_COLUMNS)[number];

export interface SchemaInputShape {
  executedAt: string;
  txType: string;
  baseSymbol: string;
  baseQty: string;
  quoteSymbol: string;
  quoteQty: string;
  priceUsd: string;
  usdjpy: string;
  feeSymbol: string;
  feeQty: string;
  venue: string;
  txHash: string;
  memo: string;
}

/** CSVのsnake_caseヘッダ行から、lib/validation/transactionのcamelCaseフィールドへ写像する。 */
export function mapCsvRowToSchemaInput(row: Record<string, string | undefined>): SchemaInputShape {
  const get = (col: CanonicalColumn) => (row[col] ?? "").trim();
  return {
    executedAt: get("executed_at"),
    txType: get("tx_type"),
    baseSymbol: get("base_symbol"),
    baseQty: get("base_qty"),
    quoteSymbol: get("quote_symbol"),
    quoteQty: get("quote_qty"),
    priceUsd: get("price_usd"),
    usdjpy: get("usdjpy"),
    feeSymbol: get("fee_symbol"),
    feeQty: get("fee_qty"),
    venue: get("venue"),
    txHash: get("tx_hash"),
    memo: get("memo"),
  };
}

export const CANONICAL_CSV_HEADER_LINE = CANONICAL_CSV_COLUMNS.join(",");
