import Link from "next/link";
import { getLocationBreakdown } from "@/lib/dashboard";
import { jstDayEndExclusive, toJstDateString } from "@/lib/datetime";
import { InventoryClient } from "./InventoryClient";

// DBを直接読むため常に動的レンダリングにする(Full Route Cache対策。app/page.tsx参照)。
export const dynamic = "force-dynamic";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const params = await searchParams;
  const date = params.date && DATE_REGEX.test(params.date) ? params.date : toJstDateString(new Date());
  // 棚卸し日の終わり(翌日0:00 JST)より前の取引だけで台帳を作る。後日の取引が比較を歪めないように。
  const breakdown = await getLocationBreakdown(jstDayEndExclusive(date));

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">棚卸し</h1>
        <Link href="/import/batches" className="text-sm text-blue-700 hover:underline">
          バッチ一覧
        </Link>
      </div>

      <div className="space-y-1 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
        <p>保管場所ごとに実際の残高を入力すると、台帳より少ない分(手数料等による目減り)を fee 行として計上します。</p>
        <p>
          fee 行は「時価で譲渡+同額を必要経費」として計算されるため、正味の損失は平均取得単価×目減り数量です。
          台帳より多い分は未記録の受取(所得)の可能性があるため、自動では計上しません。
        </p>
        <p>
          実残高は棚卸し日の終わり時点の値を入力してください。その日の終値は翌日09:00(JST)に確定するので、それ以降に登録すると確定値で計上されます
          (早く登録した場合も <code>npm run audit -- --fix</code> で直せます)。登録した fee 行はバッチ一覧から取り消せます。
        </p>
      </div>

      <form method="get" className="flex items-center gap-2 text-sm">
        <label htmlFor="inventory-date" className="font-medium">
          棚卸し日
        </label>
        <input
          id="inventory-date"
          type="date"
          name="date"
          defaultValue={date}
          className="rounded border border-gray-300 px-2 py-1"
        />
        <button type="submit" className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50">
          この日付の台帳を表示
        </button>
      </form>

      <InventoryClient
        key={date}
        date={date}
        rows={breakdown.map((b) => ({ symbol: b.symbol, location: b.location, ledgerQty: b.qty.toFixed() }))}
      />
    </div>
  );
}
