import { lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, type TxType } from "@/lib/db/schema";
import { Decimal } from "@/lib/decimal";
import { jstYear, jstYearRange, toUtcDateString } from "@/lib/datetime";
import { lookupDailyCloseFromDb } from "@/lib/pricing/db";
import { MAX_DAILY_CLOSE_DAYS_BACK } from "@/lib/pricing/lookup";
import {
  buildAnnualReport,
  expandTransactions,
  type AnnualReport,
  type ExpandableTransaction,
  type FeeAssetPriceResolver,
} from "./average-cost";

const feeAssetPriceResolver: FeeAssetPriceResolver = async ({ feeAssetId, feeAssetIsStable, executedAt }) => {
  if (feeAssetIsStable) return new Decimal(1);
  const utcDate = toUtcDateString(executedAt);
  const found = await lookupDailyCloseFromDb(feeAssetId, utcDate, MAX_DAILY_CLOSE_DAYS_BACK);
  return found ? new Decimal(found.closeUsd) : null;
};

async function fetchTransactionsThroughYear(year: number): Promise<ExpandableTransaction[]> {
  const { end } = jstYearRange(year);
  const rows = await db.query.transactions.findMany({
    where: lt(transactions.executedAt, end),
    with: { baseAsset: true, quoteAsset: true, feeAsset: true },
    orderBy: transactions.executedAt,
  });

  return rows.map((r) => ({
    id: r.id,
    executedAt: r.executedAt,
    txType: r.txType as TxType,
    baseSymbol: r.baseAsset.symbol,
    baseQty: r.baseQty,
    quoteSymbol: r.quoteAsset?.symbol ?? null,
    quoteQty: r.quoteQty,
    jpyValue: r.jpyValue,
    usdjpy: r.usdjpy,
    feeSymbol: r.feeAsset?.symbol ?? null,
    feeQty: r.feeQty,
    feeAssetId: r.feeAsset?.id ?? null,
    feeAssetIsStable: r.feeAsset?.assetClass === "stable",
  }));
}

/** §6 のオーケストレーション: DBから取引を取得し、展開してtargetYearのレポートを組み立てる。 */
export async function generateAnnualReport(targetYear: number): Promise<AnnualReport> {
  const rows = await fetchTransactionsThroughYear(targetYear);
  const expansion = await expandTransactions(rows, feeAssetPriceResolver);
  return buildAnnualReport(expansion, targetYear);
}

/** レポート対象年の選択肢用: 取引が存在するJST年(§2-4)の一覧を返す。 */
export async function listReportableYears(): Promise<number[]> {
  const rows = await db.select({ executedAt: transactions.executedAt }).from(transactions);
  const years = new Set(rows.map((r) => jstYear(r.executedAt)));
  return Array.from(years).sort((a, b) => b - a);
}
