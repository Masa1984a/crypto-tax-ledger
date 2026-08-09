import Papa from "papaparse";
import type { AnnualReport } from "@/lib/tax/average-cost";

// §6.4 レポート出力列(資産別)
const REPORT_CSV_HEADERS = [
  "symbol",
  "期首数量",
  "期首取得価額",
  "年中購入数量",
  "年中購入金額",
  "年中売却数量",
  "年中売却金額",
  "平均単価",
  "譲渡原価",
  "実現損益",
  "期末数量",
  "期末取得価額",
  "報酬所得",
  "手数料経費",
] as const;

export function buildAnnualReportCsv(report: AnnualReport): string {
  const rows = report.assets.map((a) => [
    a.symbol,
    a.openingQty.toFixed(),
    a.openingCostJpy.toFixed(2),
    a.acquiredQty.toFixed(),
    a.acquiredCostJpy.toFixed(2),
    a.disposedQty.toFixed(),
    a.disposedProceedsJpy.toFixed(2),
    a.averageUnitCost.toFixed(2),
    a.costOfGoodsSoldJpy.toFixed(2),
    a.realizedGainJpy.toFixed(2),
    a.closingQty.toFixed(),
    a.closingCostJpy.toFixed(2),
    a.rewardIncomeJpy.toFixed(2),
    a.feeExpenseJpy.toFixed(2),
  ]);

  return Papa.unparse({ fields: [...REPORT_CSV_HEADERS], data: rows });
}
