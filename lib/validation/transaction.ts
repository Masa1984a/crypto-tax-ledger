import { z } from "zod";
import { Decimal } from "@/lib/decimal";
import { normalizeNumericInput } from "@/lib/numeric";
import { TX_TYPES } from "@/lib/db/schema";

// §5.2: executed_at はタイムゾーンオフセット付きISO 8601必須(オフセットなしはエラー)。受け入れ基準11。
const ISO_OFFSET_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export const executedAtSchema = z
  .string()
  .trim()
  .regex(
    ISO_OFFSET_REGEX,
    "タイムゾーンオフセット付きのISO 8601形式で入力してください(例: 2026-08-01T12:00:00+09:00)"
  )
  .refine((val) => !Number.isNaN(new Date(val).getTime()), "日時として解釈できません");

export const symbolSchema = z
  .string()
  .trim()
  .min(1, "銘柄を入力してください")
  .transform((s) => s.toUpperCase());

function decimalStringSchema(opts: { requirePositive: boolean; label: string }) {
  return z
    .string()
    .trim()
    .min(1, `${opts.label}を入力してください`)
    .transform((val) => normalizeNumericInput(val))
    .refine((val) => {
      try {
        const d = new Decimal(val);
        return d.isFinite() && (!opts.requirePositive || d.isPositive());
      } catch {
        return false;
      }
    }, `${opts.label}が有効な数値ではありません`);
}

export const qtySchema = (label: string) => decimalStringSchema({ requirePositive: true, label });
export const priceLikeSchema = (label: string) => decimalStringSchema({ requirePositive: true, label });

// HTMLフォームの空欄は "" (undefinedではない)として届く。Zodの.optional()は
// undefinedしか「未指定」とみなさないため、""/nullを事前にundefinedへ正規化してから
// .optional()に渡す(でないと空欄の任意項目がmin(1)で毎回バリデーションエラーになる)。
function emptyToUndefined(val: unknown) {
  if (val == null) return undefined;
  if (typeof val === "string" && val.trim() === "") return undefined;
  return val;
}

const optionalSymbol = z.preprocess(emptyToUndefined, symbolSchema.optional());
const optionalText = z.preprocess(emptyToUndefined, z.string().trim().optional());
const optionalQty = (label: string) => z.preprocess(emptyToUndefined, qtySchema(label).optional());
const optionalPriceLike = (label: string) => z.preprocess(emptyToUndefined, priceLikeSchema(label).optional());

const transactionBaseObjectSchema = z.object({
  executedAt: executedAtSchema,
  txType: z.enum(TX_TYPES),
  baseSymbol: symbolSchema,
  baseQty: qtySchema("base_qty"),
  quoteSymbol: optionalSymbol,
  quoteQty: optionalQty("quote_qty"),
  priceUsd: optionalPriceLike("price_usd"),
  usdjpy: optionalPriceLike("usdjpy"),
  feeSymbol: optionalSymbol,
  feeQty: optionalQty("fee_qty"),
  venue: optionalText,
  txHash: optionalText,
  memo: optionalText,
});

function applyCommonRules<T extends z.infer<typeof transactionBaseObjectSchema>>(data: T, ctx: z.RefinementCtx) {
  const exchangeTypes = new Set(["buy", "sell", "swap"]);
  const needsQuote = exchangeTypes.has(data.txType);

  if (needsQuote) {
    if (!data.quoteSymbol) {
      ctx.addIssue({ code: "custom", path: ["quoteSymbol"], message: `${data.txType}にはquote_symbolが必須です` });
    }
    if (!data.quoteQty) {
      ctx.addIssue({ code: "custom", path: ["quoteQty"], message: `${data.txType}にはquote_qtyが必須です` });
    }
  } else {
    if (data.quoteSymbol || data.quoteQty) {
      ctx.addIssue({
        code: "custom",
        path: ["quoteSymbol"],
        message: `${data.txType}ではquote_symbol/quote_qtyは指定できません`,
      });
    }
  }

  if (Boolean(data.feeSymbol) !== Boolean(data.feeQty)) {
    ctx.addIssue({
      code: "custom",
      path: ["feeQty"],
      message: "fee_symbolとfee_qtyは両方指定するか、両方省略してください",
    });
  }

  if (data.baseSymbol === "JPY" && data.quoteSymbol === "JPY") {
    ctx.addIssue({ code: "custom", path: ["quoteSymbol"], message: "base/quoteの両方をJPYにはできません" });
  }
}

// 新規作成用: price_usd/usdjpyは「明示上書き」の位置づけなので省略可(省略時は§4で自動補完)。
export const transactionInputSchema = transactionBaseObjectSchema.superRefine(applyCommonRules);

export type TransactionInput = z.infer<typeof transactionInputSchema>;

export const PRICE_SOURCES = ["manual", "derived", "daily_close", "daily_close_prev"] as const;

// 編集用: price_usd/usdjpy/jpy_valueは自動補完されず(§2-8 スナップショット原則)、
// 「参照テーブルから価格を再取得」ボタンを押した場合のみ再計算される直接編集可能な値。
export const transactionUpdateSchema = transactionBaseObjectSchema
  .extend({
    priceUsd: priceLikeSchema("price_usd"),
    usdjpy: priceLikeSchema("usdjpy"),
    jpyValue: priceLikeSchema("jpy_value"),
    priceSource: z.enum(PRICE_SOURCES),
  })
  .superRefine(applyCommonRules);

export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>;

export const TX_TYPE_LABELS: Record<(typeof TX_TYPES)[number], string> = {
  buy: "購入 (buy)",
  sell: "売却 (sell)",
  swap: "交換 (swap)",
  reward: "報酬 (reward)",
  fee: "手数料単独 (fee)",
  transfer_in: "受入 (transfer_in)",
  transfer_out: "送出 (transfer_out)",
};
