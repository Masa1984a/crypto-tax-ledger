import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { Decimal } from "@/lib/decimal";
import { buildAnnualReportCsv } from "@/lib/csv/export";
import type { AnnualReport } from "@/lib/tax/average-cost";

function d(v: string) {
  return new Decimal(v);
}

describe("buildAnnualReportCsv", () => {
  it("§6.4 の列順・値でCSVを生成する", () => {
    const report: AnnualReport = {
      year: 2026,
      assets: [
        {
          symbol: "BTC",
          year: 2026,
          openingQty: d("0.1"),
          openingCostJpy: d("1000000"),
          acquiredQty: d("0.1"),
          acquiredCostJpy: d("1400000"),
          disposedQty: d("0.05"),
          disposedProceedsJpy: d("800000"),
          averageUnitCost: d("12000000"),
          costOfGoodsSoldJpy: d("600000"),
          realizedGainJpy: d("200000"),
          closingQty: d("0.15"),
          closingCostJpy: d("1800000"),
          rewardIncomeJpy: d("0"),
          feeExpenseJpy: d("0"),
          warnings: [],
        },
      ],
      totalRealizedGainJpy: d("200000"),
      totalRewardIncomeJpy: d("0"),
      totalFeeExpenseJpy: d("0"),
      miscIncomeJpy: d("200000"),
      warnings: [],
    };

    const csv = buildAnnualReportCsv(report);
    const parsed = Papa.parse(csv, { header: true });
    expect(parsed.data).toEqual([
      {
        symbol: "BTC",
        期首数量: "0.1",
        期首取得価額: "1000000.00",
        年中購入数量: "0.1",
        年中購入金額: "1400000.00",
        年中売却数量: "0.05",
        年中売却金額: "800000.00",
        平均単価: "12000000.00",
        譲渡原価: "600000.00",
        実現損益: "200000.00",
        期末数量: "0.15",
        期末取得価額: "1800000.00",
        報酬所得: "0.00",
        手数料経費: "0.00",
      },
    ]);
  });
});
