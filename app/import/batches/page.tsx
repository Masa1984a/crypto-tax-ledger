import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { importBatches, transactions } from "@/lib/db/schema";
import { formatJst } from "@/lib/datetime";
import { CancelBatchButton } from "./CancelBatchButton";

// DBを直接読むため常に動的レンダリングにする(Full Route Cache対策。app/page.tsx参照)。
export const dynamic = "force-dynamic";

export default async function ImportBatchesPage() {
  const rows = await db
    .select({
      id: importBatches.id,
      filename: importBatches.filename,
      rowCount: importBatches.rowCount,
      createdAt: importBatches.createdAt,
      remainingCount: sql<number>`count(${transactions.id})::int`,
    })
    .from(importBatches)
    .leftJoin(transactions, eq(transactions.importBatchId, importBatches.id))
    .groupBy(importBatches.id)
    .orderBy(desc(importBatches.createdAt));

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">インポートバッチ一覧</h1>
        <Link href="/import" className="text-sm text-blue-700 hover:underline">
          CSV取込に戻る
        </Link>
      </div>

      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">ファイル名</th>
              <th className="px-3 py-2">日時</th>
              <th className="px-3 py-2 text-right">取込件数</th>
              <th className="px-3 py-2 text-right">現在の件数</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className="border-t border-gray-100">
                <td className="px-3 py-2">{b.id}</td>
                <td className="px-3 py-2">{b.filename ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {b.createdAt ? formatJst(b.createdAt, "yyyy-MM-dd HH:mm") : "-"}
                </td>
                <td className="px-3 py-2 text-right">{b.rowCount ?? "-"}</td>
                <td className="px-3 py-2 text-right">
                  {b.remainingCount}
                  {b.remainingCount === 0 && b.rowCount ? (
                    <span className="ml-2 text-xs text-gray-400">(取消済み)</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right">
                  {b.remainingCount > 0 && <CancelBatchButton batchId={b.id} rowCount={b.remainingCount} />}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                  バッチはまだありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
