"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, TX_TYPES, type TxType } from "@/lib/db/schema";
import { getAssetBySymbol, toAssetInfo } from "@/lib/db/assets";
import { findTransactionByRowHash, rowHashConflictTarget } from "@/lib/db/transactions";
import { computeRowHash } from "@/lib/hash";
import { normalizeNumericInput } from "@/lib/numeric";
import { Decimal } from "@/lib/decimal";
import { jstYearRange } from "@/lib/datetime";
import { PricingError, type PriceSource } from "@/lib/pricing/lookup";
import { resolveConversion } from "@/lib/pricing/db";
import { transactionInputSchema, transactionUpdateSchema } from "@/lib/validation/transaction";

const ISO_OFFSET_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const EXCHANGE_TYPES = new Set(["buy", "sell", "swap"]);

export interface PreviewInput {
  executedAt: string;
  txType: string;
  baseSymbol: string;
  baseQty: string;
  quoteSymbol?: string | null;
  quoteQty?: string | null;
  priceUsd?: string | null;
  usdjpy?: string | null;
}

export type PreviewResult =
  | { status: "pending" }
  | { status: "error"; reason: string }
  | {
      status: "ok";
      priceUsd: string;
      usdjpy: string;
      jpyValue: string;
      priceSource: PriceSource;
      warning?: string;
    };

/**
 * §5.1 UX要件: executed_atと銘柄を入力した時点でプリフィルするための、書き込みを伴わないプレビュー。
 * 入力途中(未確定)は "pending" を返して静かに待つ。
 */
export async function previewConversion(input: PreviewInput): Promise<PreviewResult> {
  const executedAtRaw = input.executedAt?.trim();
  const baseSymbolRaw = input.baseSymbol?.trim();
  const baseQtyRaw = input.baseQty?.trim();

  if (!executedAtRaw || !baseSymbolRaw || !baseQtyRaw || !ISO_OFFSET_REGEX.test(executedAtRaw)) {
    return { status: "pending" };
  }
  if (Number.isNaN(new Date(executedAtRaw).getTime())) {
    return { status: "pending" };
  }

  const baseQtyNorm = normalizeNumericInput(baseQtyRaw);
  try {
    if (!new Decimal(baseQtyNorm).isPositive()) return { status: "pending" };
  } catch {
    return { status: "pending" };
  }

  const baseAsset = await getAssetBySymbol(baseSymbolRaw);
  if (!baseAsset) {
    return { status: "error", reason: `不明な銘柄です: ${baseSymbolRaw.toUpperCase()}` };
  }

  const quoteSymbolRaw = input.quoteSymbol?.trim();
  const quoteAsset = quoteSymbolRaw ? await getAssetBySymbol(quoteSymbolRaw) : undefined;
  if (quoteSymbolRaw && !quoteAsset) {
    return { status: "error", reason: `不明な銘柄です: ${quoteSymbolRaw.toUpperCase()}` };
  }

  const quoteQtyRaw = input.quoteQty?.trim();
  if (EXCHANGE_TYPES.has(input.txType) && (!quoteAsset || !quoteQtyRaw)) {
    return { status: "pending" };
  }

  try {
    const result = await resolveConversion({
      executedAt: new Date(executedAtRaw),
      baseAsset: toAssetInfo(baseAsset),
      baseQty: baseQtyNorm,
      quoteAsset: quoteAsset ? toAssetInfo(quoteAsset) : null,
      quoteQty: quoteQtyRaw ? normalizeNumericInput(quoteQtyRaw) : null,
      explicitPriceUsd: input.priceUsd?.trim() ? normalizeNumericInput(input.priceUsd) : null,
      explicitUsdjpy: input.usdjpy?.trim() ? normalizeNumericInput(input.usdjpy) : null,
    });
    return { status: "ok", ...result };
  } catch (err) {
    return { status: "error", reason: err instanceof PricingError ? err.message : String(err) };
  }
}

export interface MutationResult {
  success: boolean;
  error?: string;
  existingId?: number;
  id?: number;
}

export async function createTransaction(raw: unknown): Promise<MutationResult> {
  const parsed = transactionInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join(" / ") };
  }
  const data = parsed.data;

  const baseAsset = await getAssetBySymbol(data.baseSymbol);
  if (!baseAsset) return { success: false, error: `不明な銘柄です: ${data.baseSymbol}` };

  const quoteAsset = data.quoteSymbol ? await getAssetBySymbol(data.quoteSymbol) : undefined;
  if (data.quoteSymbol && !quoteAsset) {
    return { success: false, error: `不明な銘柄です: ${data.quoteSymbol}` };
  }

  const feeAsset = data.feeSymbol ? await getAssetBySymbol(data.feeSymbol) : undefined;
  if (data.feeSymbol && !feeAsset) {
    return { success: false, error: `不明な銘柄です: ${data.feeSymbol}` };
  }

  const executedAt = new Date(data.executedAt);

  let conversion;
  try {
    conversion = await resolveConversion({
      executedAt,
      baseAsset: toAssetInfo(baseAsset),
      baseQty: data.baseQty,
      quoteAsset: quoteAsset ? toAssetInfo(quoteAsset) : null,
      quoteQty: data.quoteQty ?? null,
      explicitPriceUsd: data.priceUsd ?? null,
      explicitUsdjpy: data.usdjpy ?? null,
    });
  } catch (err) {
    return { success: false, error: err instanceof PricingError ? err.message : String(err) };
  }

  const rowHash = computeRowHash({
    executedAt,
    txType: data.txType,
    baseSymbol: data.baseSymbol,
    baseQty: data.baseQty,
    quoteSymbol: data.quoteSymbol ?? null,
    quoteQty: data.quoteQty ?? null,
    venue: data.venue ?? null,
    txHash: data.txHash ?? null,
  });

  const inserted = await db
    .insert(transactions)
    .values({
      executedAt,
      txType: data.txType,
      baseAssetId: baseAsset.id,
      baseQty: data.baseQty,
      quoteAssetId: quoteAsset?.id,
      quoteQty: data.quoteQty ?? null,
      priceUsd: conversion.priceUsd,
      usdjpy: conversion.usdjpy,
      jpyValue: conversion.jpyValue,
      priceSource: conversion.priceSource,
      feeAssetId: feeAsset?.id,
      feeQty: data.feeQty ?? null,
      venue: data.venue ?? null,
      txHash: data.txHash ?? null,
      memo: data.memo ?? null,
      location: data.location ?? null,
      rowHash,
    })
    .onConflictDoNothing(rowHashConflictTarget)
    .returning({ id: transactions.id });

  if (inserted.length === 0) {
    const existing = await findTransactionByRowHash(rowHash);
    return {
      success: false,
      error: `同一取引が登録済みです(ID: ${existing?.id ?? "?"})`,
      existingId: existing?.id,
    };
  }

  revalidatePath("/transactions");
  revalidatePath("/");
  return { success: true, id: inserted[0].id };
}

export async function updateTransaction(id: number, raw: unknown): Promise<MutationResult> {
  const parsed = transactionUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join(" / ") };
  }
  const data = parsed.data;

  const baseAsset = await getAssetBySymbol(data.baseSymbol);
  if (!baseAsset) return { success: false, error: `不明な銘柄です: ${data.baseSymbol}` };

  const quoteAsset = data.quoteSymbol ? await getAssetBySymbol(data.quoteSymbol) : undefined;
  if (data.quoteSymbol && !quoteAsset) {
    return { success: false, error: `不明な銘柄です: ${data.quoteSymbol}` };
  }

  const feeAsset = data.feeSymbol ? await getAssetBySymbol(data.feeSymbol) : undefined;
  if (data.feeSymbol && !feeAsset) {
    return { success: false, error: `不明な銘柄です: ${data.feeSymbol}` };
  }

  const executedAt = new Date(data.executedAt);
  const rowHash = computeRowHash({
    executedAt,
    txType: data.txType,
    baseSymbol: data.baseSymbol,
    baseQty: data.baseQty,
    quoteSymbol: data.quoteSymbol ?? null,
    quoteQty: data.quoteQty ?? null,
    venue: data.venue ?? null,
    txHash: data.txHash ?? null,
  });

  // row_hashが他の既存行と衝突する場合は事前に検知する(部分UNIQUEインデックス違反を待つより明確)
  const collision = await findTransactionByRowHash(rowHash);
  if (collision && collision.id !== id) {
    return {
      success: false,
      error: `同一取引が既に登録されています(ID: ${collision.id})`,
      existingId: collision.id,
    };
  }

  await db
    .update(transactions)
    .set({
      executedAt,
      txType: data.txType,
      baseAssetId: baseAsset.id,
      baseQty: data.baseQty,
      quoteAssetId: quoteAsset?.id ?? null,
      quoteQty: data.quoteQty ?? null,
      priceUsd: data.priceUsd,
      usdjpy: data.usdjpy,
      jpyValue: data.jpyValue,
      priceSource: data.priceSource,
      feeAssetId: feeAsset?.id ?? null,
      feeQty: data.feeQty ?? null,
      venue: data.venue ?? null,
      txHash: data.txHash ?? null,
      memo: data.memo ?? null,
      location: data.location ?? null,
      rowHash,
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, id));

  revalidatePath("/transactions");
  revalidatePath("/");
  return { success: true, id };
}

export async function deleteTransaction(id: number): Promise<MutationResult> {
  await db.delete(transactions).where(eq(transactions.id, id));
  revalidatePath("/transactions");
  revalidatePath("/");
  return { success: true, id };
}

export interface LocationBulkFilter {
  year?: string;
  asset?: string;
  venue?: string;
  txType?: string;
  location?: string;
}

export interface BulkLocationResult {
  success: boolean;
  error?: string;
  updatedCount?: number;
}

/**
 * 一覧の現在の絞り込み条件(§5.3のフィルタと同じ形)に一致する取引へ、まとめて保管場所を設定する。
 * 誤操作防止のため、絞り込み条件が1つも無い(=全件対象)状態では実行できない。
 */
export async function bulkSetLocation(filter: LocationBulkFilter, location: string): Promise<BulkLocationResult> {
  const trimmedLocation = location.trim();
  if (!trimmedLocation) {
    return { success: false, error: "保管場所を入力してください" };
  }

  const conditions = [];
  if (filter.year) {
    const y = Number(filter.year);
    if (Number.isInteger(y)) {
      const { start, end } = jstYearRange(y);
      conditions.push(gte(transactions.executedAt, start), lt(transactions.executedAt, end));
    }
  }
  if (filter.asset) {
    const asset = await getAssetBySymbol(filter.asset);
    if (!asset) return { success: false, error: `不明な銘柄です: ${filter.asset}` };
    conditions.push(
      or(
        eq(transactions.baseAssetId, asset.id),
        eq(transactions.quoteAssetId, asset.id),
        eq(transactions.feeAssetId, asset.id)
      )
    );
  }
  if (filter.venue) {
    conditions.push(eq(transactions.venue, filter.venue));
  }
  if (filter.txType && (TX_TYPES as readonly string[]).includes(filter.txType)) {
    conditions.push(eq(transactions.txType, filter.txType as TxType));
  }
  if (filter.location) {
    conditions.push(eq(transactions.location, filter.location));
  }

  if (conditions.length === 0) {
    return { success: false, error: "絞り込み条件を1つ以上指定してください(全件一括変更は事故防止のため禁止しています)" };
  }

  const updated = await db
    .update(transactions)
    .set({ location: trimmedLocation, updatedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: transactions.id });

  revalidatePath("/transactions");
  revalidatePath("/");
  return { success: true, updatedCount: updated.length };
}
