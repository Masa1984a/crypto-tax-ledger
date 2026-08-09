import Link from "next/link";
import { notFound } from "next/navigation";
import { generateAnnualReport, listReportableYears } from "@/lib/tax/db";
import { jstYear } from "@/lib/datetime";
import { formatJpy } from "@/lib/format";
import type { Decimal } from "@/lib/decimal";

export default async function ReportPage({ params }: { params: Promise<{ year: string }> }) {
  const { year: yearParam } = await params;
  const year = Number(yearParam);
  if (!Number.isInteger(year)) notFound();

  const [report, years] = await Promise.all([generateAnnualReport(year), listReportableYears()]);
  const currentYear = jstYear(new Date());
  const yearOptions = Array.from(new Set([currentYear, year, ...years])).sort((a, b) => b - a);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">年次レポート</h1>
        <div className="flex items-center gap-3 text-sm">
          <a href={`/reports/${year}/export`} className="text-blue-700 hover:underline">
            CSVエクスポート
          </a>
          <Link href="/transactions" className="text-blue-700 hover:underline">
            取引一覧に戻る
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {yearOptions.map((y) => (
          <Link
            key={y}
            href={`/reports/${y}`}
            className={`rounded px-3 py-1 text-sm ${
              y === year ? "bg-gray-900 text-white" : "border border-gray-300 hover:bg-gray-50"
            }`}
          >
            {y}年
          </Link>
        ))}
      </div>

      {report.warnings.length > 0 && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="mb-1 font-medium">データ不整合の警告</p>
          <ul className="list-disc pl-5">
            {report.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard label="実現損益合計" value={report.totalRealizedGainJpy} />
        <SummaryCard label="報酬所得合計" value={report.totalRewardIncomeJpy} />
        <SummaryCard label="必要経費合計" value={report.totalFeeExpenseJpy} />
        <SummaryCard label="雑所得(参考値)" value={report.miscIncomeJpy} emphasize />
      </div>

      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">symbol</th>
              <th className="px-3 py-2 text-right">期首数量</th>
              <th className="px-3 py-2 text-right">期首取得価額</th>
              <th className="px-3 py-2 text-right">年中購入数量</th>
              <th className="px-3 py-2 text-right">年中購入金額</th>
              <th className="px-3 py-2 text-right">年中売却数量</th>
              <th className="px-3 py-2 text-right">年中売却金額</th>
              <th className="px-3 py-2 text-right">平均単価</th>
              <th className="px-3 py-2 text-right">譲渡原価</th>
              <th className="px-3 py-2 text-right">実現損益</th>
              <th className="px-3 py-2 text-right">期末数量</th>
              <th className="px-3 py-2 text-right">期末取得価額</th>
              <th className="px-3 py-2 text-right">報酬所得</th>
              <th className="px-3 py-2 text-right">手数料経費</th>
            </tr>
          </thead>
          <tbody>
            {report.assets.map((a) => (
              <tr key={a.symbol} className="border-t border-gray-100">
                <td className="px-3 py-2 font-mono">{a.symbol}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{a.openingQty.toFixed()}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatJpy(a.openingCostJpy)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{a.acquiredQty.toFixed()}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatJpy(a.acquiredCostJpy)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{a.disposedQty.toFixed()}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatJpy(a.disposedProceedsJpy)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatJpy(a.averageUnitCost)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatJpy(a.costOfGoodsSoldJpy)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatJpy(a.realizedGainJpy)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{a.closingQty.toFixed()}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatJpy(a.closingCostJpy)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatJpy(a.rewardIncomeJpy)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatJpy(a.feeExpenseJpy)}</td>
              </tr>
            ))}
            {report.assets.length === 0 && (
              <tr>
                <td colSpan={14} className="px-3 py-6 text-center text-gray-400">
                  {year}年の対象取引がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, emphasize }: { label: string; value: Decimal; emphasize?: boolean }) {
  return (
    <div className={`rounded border p-4 ${emphasize ? "border-gray-900" : "border-gray-200"}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-lg ${emphasize ? "font-bold" : "font-medium"}`}>{formatJpy(value)}</p>
    </div>
  );
}
