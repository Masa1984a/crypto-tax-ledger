import Link from "next/link";
import { getDataFreshness, getHoldingsSummary, getLocationBreakdown, isStale } from "@/lib/dashboard";
import { generateAnnualReport } from "@/lib/tax/db";
import { jstYear } from "@/lib/datetime";
import { formatJpy } from "@/lib/format";

export default async function DashboardPage() {
  const currentYear = jstYear(new Date());
  const [holdingsSummary, freshness, yearReport, locationBreakdown] = await Promise.all([
    getHoldingsSummary(),
    getDataFreshness(),
    generateAnnualReport(currentYear),
    getLocationBreakdown(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">ダッシュボード</h1>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/transactions" className="text-blue-700 hover:underline">
            取引一覧
          </Link>
          <Link href="/import" className="text-blue-700 hover:underline">
            CSV取込
          </Link>
          <Link href="/assets" className="text-blue-700 hover:underline">
            資産マスタ
          </Link>
          <Link href={`/reports/${currentYear}`} className="text-blue-700 hover:underline">
            年次レポート
          </Link>
          <Link
            href="/transactions/new"
            className="rounded bg-gray-900 px-3 py-1.5 text-white hover:bg-gray-700"
          >
            + 手入力
          </Link>
        </nav>
      </div>

      <FreshnessBanner freshness={freshness} />

      <section>
        <h2 className="mb-2 text-sm font-medium text-gray-600">保有資産評価額</h2>
        <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <SummaryCard label="評価額合計(円)" value={formatJpy(holdingsSummary.totalValueJpy)} />
          <SummaryCard label="評価額合計(USD)" value={`$${holdingsSummary.totalValueUsd.toFixed(2)}`} />
          <SummaryCard
            label="適用TTM"
            value={holdingsSummary.latestUsdjpy ? holdingsSummary.latestUsdjpy.toFixed(4) : "-"}
          />
        </div>
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">symbol</th>
                <th className="px-3 py-2 text-right">保有数量</th>
                <th className="px-3 py-2 text-right">最新終値(USD)</th>
                <th className="px-3 py-2 text-right">評価額(USD)</th>
                <th className="px-3 py-2 text-right">評価額(円)</th>
              </tr>
            </thead>
            <tbody>
              {holdingsSummary.holdings.map((h) => (
                <tr key={h.symbol} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono">{h.symbol}</td>
                  <td className="px-3 py-2 text-right">{h.qty.toFixed()}</td>
                  <td className="px-3 py-2 text-right">{h.closeUsd ? `$${h.closeUsd.toFixed(2)}` : "-"}</td>
                  <td className="px-3 py-2 text-right">{h.valueUsd ? `$${h.valueUsd.toFixed(2)}` : "-"}</td>
                  <td className="px-3 py-2 text-right">{h.valueJpy ? formatJpy(h.valueJpy) : "-"}</td>
                </tr>
              ))}
              {holdingsSummary.holdings.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-gray-400">
                    保有資産がありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {locationBreakdown.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-gray-600">保管場所別の内訳(取得ベース・参考値)</h2>
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">symbol</th>
                  <th className="px-3 py-2">保管場所</th>
                  <th className="px-3 py-2 text-right">数量</th>
                </tr>
              </thead>
              <tbody>
                {locationBreakdown.map((row) => (
                  <tr key={`${row.symbol}|${row.location}`} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-mono">{row.symbol}</td>
                    <td className="px-3 py-2">{row.location}</td>
                    <td className="px-3 py-2 text-right">{row.qty.toFixed()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            ※ 取得(buy/sell/swap/reward)時に設定した保管場所タグの単純合計です。その後の売却・移動は反映されません。
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-gray-600">{currentYear}年 サマリ(参考値)</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryCard label="実現損益合計" value={formatJpy(yearReport.totalRealizedGainJpy)} />
          <SummaryCard label="報酬所得合計" value={formatJpy(yearReport.totalRewardIncomeJpy)} />
          <SummaryCard label="必要経費合計" value={formatJpy(yearReport.totalFeeExpenseJpy)} />
          <SummaryCard label="雑所得(参考値)" value={formatJpy(yearReport.miscIncomeJpy)} emphasize />
        </div>
        {yearReport.warnings.length > 0 && (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="mb-1 font-medium">データ不整合の警告</p>
            <ul className="list-disc pl-5">
              {yearReport.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className={`rounded border p-4 ${emphasize ? "border-gray-900" : "border-gray-200"}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-lg ${emphasize ? "font-bold" : "font-medium"}`}>{value}</p>
    </div>
  );
}

function FreshnessBanner({
  freshness,
}: {
  freshness: Awaited<ReturnType<typeof getDataFreshness>>;
}) {
  const priceStale = isStale(freshness.priceStaleDays);
  const rateStale = isStale(freshness.rateStaleDays);

  return (
    <div className="space-y-2">
      {/* daily_prices: 自動cron稼働中。古い場合はcron失敗の実害を示す警告。 */}
      {priceStale ? (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          ⚠ 価格データが古い可能性があります(cronの失敗を確認してください): 最終日=
          {freshness.latestPriceDate ?? "取得なし"}
        </div>
      ) : (
        <div className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          価格データ最終日: {freshness.latestPriceDate ?? "-"} (最新)
        </div>
      )}

      {/* fx_rates(みずほTTM): VercelからはAkamai WAFに403で拒否されるため自動cronは組んでいない。
          手動 `npm run backfill` 運用が前提なので、古い=障害ではなく「更新してください」の案内。 */}
      {rateStale ? (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ℹ 為替レート(みずほTTM)の最終日={freshness.latestRateDate ?? "取得なし"}
          。自動取得は行っていないため、確定申告前など必要なタイミングでご自身のPCから{" "}
          <code className="rounded bg-amber-100 px-1">npm run backfill</code> を実行してください。
        </div>
      ) : (
        <div className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          為替レート最終日: {freshness.latestRateDate ?? "-"} (最新)
        </div>
      )}
    </div>
  );
}
