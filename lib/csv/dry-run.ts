import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets, importBatches, transactions, type Asset, type TxType } from "@/lib/db/schema";
import { txDb } from "@/lib/db/transactional";
import { toAssetInfo } from "@/lib/db/assets";
import { rowHashConflictTarget } from "@/lib/db/transactions";
import { resolveConversion, lookupSameDayCloseFromDb } from "@/lib/pricing/db";
import { checkPriceDeviation, PricingError, type PriceSource } from "@/lib/pricing/lookup";
import { computeRowHash } from "@/lib/hash";
import { toUtcDateString } from "@/lib/datetime";
import { parseCanonicalCsv } from "./parse";

export type RowStatus = "ok" | "warning" | "duplicate" | "error";

export interface ResolvedRow {
  executedAt: Date;
  txType: TxType;
  baseAssetId: number;
  baseSymbol: string;
  baseQty: string;
  quoteAssetId?: number;
  quoteSymbol?: string;
  quoteQty?: string;
  priceUsd: string;
  usdjpy: string;
  jpyValue: string;
  priceSource: PriceSource;
  feeAssetId?: number;
  feeSymbol?: string;
  feeQty?: string;
  venue?: string;
  txHash?: string;
  memo?: string;
  location?: string;
  rowHash: string;
}

export interface DryRunRowResult {
  rowNumber: number;
  status: RowStatus;
  messages: string[];
  raw: Record<string, string>;
  resolved?: ResolvedRow;
}

export interface DryRunReport {
  headerError?: string;
  rows: DryRunRowResult[];
  summary: { ok: number; warning: number; duplicate: number; error: number };
  unknownSymbols: string[];
}

/**
 * §5.2 2段階フローの1段目(検証/dry-run)。DBに一切書き込まない。
 */
export async function runDryRun(csvText: string): Promise<DryRunReport> {
  const emptySummary = { ok: 0, warning: 0, duplicate: 0, error: 0 };
  const parsed = parseCanonicalCsv(csvText);
  if (parsed.headerError) {
    return { headerError: parsed.headerError, rows: [], summary: emptySummary, unknownSymbols: [] };
  }

  const allAssets = await db.select().from(assets);
  const assetBySymbol = new Map<string, Asset>(allAssets.map((a) => [a.symbol, a]));

  const unknownSymbolsSet = new Set<string>();
  const results: DryRunRowResult[] = [];
  const seenHashesInFile = new Set<string>();

  for (const row of parsed.rows) {
    if (row.parseError) {
      results.push({ rowNumber: row.rowNumber, status: "error", messages: [row.parseError], raw: row.raw });
      continue;
    }
    const data = row.data!;

    const baseAsset = assetBySymbol.get(data.baseSymbol);
    if (!baseAsset) unknownSymbolsSet.add(data.baseSymbol);
    const quoteAsset = data.quoteSymbol ? assetBySymbol.get(data.quoteSymbol) : undefined;
    if (data.quoteSymbol && !quoteAsset) unknownSymbolsSet.add(data.quoteSymbol);
    const feeAsset = data.feeSymbol ? assetBySymbol.get(data.feeSymbol) : undefined;
    if (data.feeSymbol && !feeAsset) unknownSymbolsSet.add(data.feeSymbol);

    if (!baseAsset || (data.quoteSymbol && !quoteAsset) || (data.feeSymbol && !feeAsset)) {
      const missing = [
        !baseAsset ? data.baseSymbol : null,
        data.quoteSymbol && !quoteAsset ? data.quoteSymbol : null,
        data.feeSymbol && !feeAsset ? data.feeSymbol : null,
      ].filter((s): s is string => Boolean(s));
      results.push({
        rowNumber: row.rowNumber,
        status: "error",
        messages: [`マスタに無い銘柄です: ${missing.join(", ")}`],
        raw: row.raw,
      });
      continue;
    }

    const executedAt = new Date(data.executedAt);
    const messages: string[] = [];
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
      results.push({
        rowNumber: row.rowNumber,
        status: "error",
        messages: [err instanceof PricingError ? err.message : String(err)],
        raw: row.raw,
      });
      continue;
    }
    if (conversion.warning) messages.push(conversion.warning);

    // §5.2 暗黙単価チェック: manual/derivedの場合のみ、当日daily_closeと比較して±20%を警告
    if (conversion.priceSource === "manual" || conversion.priceSource === "derived") {
      const utcDate = toUtcDateString(executedAt);
      const referenceClose = await lookupSameDayCloseFromDb(baseAsset.id, utcDate);
      if (referenceClose) {
        const deviation = checkPriceDeviation(conversion.priceUsd, referenceClose);
        if (deviation.exceedsThreshold) {
          messages.push(
            `終値(${deviation.referenceCloseUsd} USD)との乖離が${deviation.deviationPct}%です(閾値20%、桁誤り・日付ズレ・base/quote取り違え等を確認してください)`
          );
        }
      }
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

    const isDuplicateInFile = seenHashesInFile.has(rowHash);
    seenHashesInFile.add(rowHash);
    if (isDuplicateInFile) messages.push("ファイル内で重複しています(スキップ予定)");

    results.push({
      rowNumber: row.rowNumber,
      status: isDuplicateInFile ? "duplicate" : messages.length > 0 ? "warning" : "ok",
      messages,
      raw: row.raw,
      resolved: {
        executedAt,
        txType: data.txType as TxType,
        baseAssetId: baseAsset.id,
        baseSymbol: data.baseSymbol,
        baseQty: data.baseQty,
        quoteAssetId: quoteAsset?.id,
        quoteSymbol: data.quoteSymbol,
        quoteQty: data.quoteQty,
        priceUsd: conversion.priceUsd,
        usdjpy: conversion.usdjpy,
        jpyValue: conversion.jpyValue,
        priceSource: conversion.priceSource,
        feeAssetId: feeAsset?.id,
        feeSymbol: data.feeSymbol,
        feeQty: data.feeQty,
        venue: data.venue,
        txHash: data.txHash,
        memo: data.memo,
        location: data.location,
        rowHash,
      },
    });
  }

  // 既存DBとの重複チェック(バッチ1クエリ)。§5.2: 「スキップ予定」として表示。
  const candidateHashes = results.filter((r) => r.resolved && r.status !== "duplicate").map((r) => r.resolved!.rowHash);
  if (candidateHashes.length > 0) {
    const existing = await db
      .select({ rowHash: transactions.rowHash })
      .from(transactions)
      .where(inArray(transactions.rowHash, candidateHashes));
    const existingSet = new Set(existing.map((e) => e.rowHash));
    for (const r of results) {
      if (r.resolved && r.status !== "duplicate" && existingSet.has(r.resolved.rowHash)) {
        r.status = "duplicate";
        r.messages.push("既に登録済みです(スキップ予定)");
      }
    }
  }

  const summary = {
    ok: results.filter((r) => r.status === "ok").length,
    warning: results.filter((r) => r.status === "warning").length,
    duplicate: results.filter((r) => r.status === "duplicate").length,
    error: results.filter((r) => r.status === "error").length,
  };

  return { rows: results, summary, unknownSymbols: Array.from(unknownSymbolsSet).sort() };
}

export interface CommitResult {
  success: boolean;
  error?: string;
  batchId?: number;
  inserted?: number;
  skipped?: number;
}

/**
 * §5.2 2段階フローの2段目(確定)。dry-runをサーバ側で再実行してから、
 * import_batches 1行 + transactions 一括INSERT を db.transaction() でアトミックに行う。
 */
export async function commitImport(
  csvText: string,
  filename: string,
  opts: { acknowledgeErrors: boolean }
): Promise<CommitResult> {
  const report = await runDryRun(csvText);
  if (report.headerError) {
    return { success: false, error: report.headerError };
  }
  if (report.summary.error > 0 && !opts.acknowledgeErrors) {
    return {
      success: false,
      error: `エラー行が${report.summary.error}件あります。エラー行を除いて登録する場合はチェックを入れてください。`,
    };
  }

  const insertable = report.rows.filter((r) => r.status === "ok" || r.status === "warning");
  if (insertable.length === 0) {
    return { success: false, error: "登録可能な行がありません(すべて重複またはエラーです)" };
  }

  const { batchId, insertedCount } = await txDb.transaction(async (tx) => {
    const [batch] = await tx
      .insert(importBatches)
      .values({ filename, rowCount: insertable.length })
      .returning({ id: importBatches.id });

    const inserted = await tx
      .insert(transactions)
      .values(
        insertable.map((r) => ({
          executedAt: r.resolved!.executedAt,
          txType: r.resolved!.txType,
          baseAssetId: r.resolved!.baseAssetId,
          baseQty: r.resolved!.baseQty,
          quoteAssetId: r.resolved!.quoteAssetId,
          quoteQty: r.resolved!.quoteQty,
          priceUsd: r.resolved!.priceUsd,
          usdjpy: r.resolved!.usdjpy,
          jpyValue: r.resolved!.jpyValue,
          priceSource: r.resolved!.priceSource,
          feeAssetId: r.resolved!.feeAssetId,
          feeQty: r.resolved!.feeQty,
          venue: r.resolved!.venue,
          txHash: r.resolved!.txHash,
          memo: r.resolved!.memo,
          location: r.resolved!.location,
          importBatchId: batch.id,
          rowHash: r.resolved!.rowHash,
        }))
      )
      .onConflictDoNothing(rowHashConflictTarget)
      .returning({ id: transactions.id });

    return { batchId: batch.id, insertedCount: inserted.length };
  });

  return {
    success: true,
    batchId,
    inserted: insertedCount,
    skipped: insertable.length - insertedCount + report.summary.duplicate,
  };
}
