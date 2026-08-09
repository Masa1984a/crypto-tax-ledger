import { createHash } from "node:crypto";
import { Decimal } from "./decimal";

/**
 * §3.2 norm(数値): 前後空白除去、指数表記禁止、末尾ゼロと末尾小数点を除去した10進文字列。
 * 空値は空文字列のまま返す(ハッシュ対象外の欠損値を表す)。
 */
export function normNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const trimmed = value.toString().trim();
  if (trimmed === "") return "";
  // toFixed() は引数省略時、指数表記を使わず、Decimal内部で正規化済みの
  // (末尾ゼロが除去された)値をそのまま文字列化する。
  return new Decimal(trimmed).toFixed();
}

export interface RowHashInput {
  executedAt: Date;
  txType: string;
  baseSymbol: string;
  baseQty: string | number;
  quoteSymbol?: string | null;
  quoteQty?: string | number | null;
  venue?: string | null;
  txHash?: string | null;
}

function isoUtcSeconds(date: Date): string {
  const truncated = new Date(date.getTime());
  truncated.setUTCMilliseconds(0);
  return truncated.toISOString().replace(".000Z", "Z");
}

/**
 * §3.2 row_hash(冪等性キー)
 * price_usd / usdjpy / jpy_value はハッシュに含めない。
 */
export function computeRowHash(input: RowHashInput): string {
  const parts = [
    isoUtcSeconds(input.executedAt),
    input.txType,
    input.baseSymbol.toUpperCase(),
    normNumber(input.baseQty),
    (input.quoteSymbol ?? "").toUpperCase(),
    normNumber(input.quoteQty ?? ""),
    (input.venue ?? "").toUpperCase(),
    (input.txHash ?? "").toLowerCase(),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}
