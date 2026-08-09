import Link from "next/link";
import { and, desc, eq, gte, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, TX_TYPES } from "@/lib/db/schema";
import { listAssets } from "@/lib/db/assets";
import { formatJst, jstYear, jstYearRange } from "@/lib/datetime";
import { formatJpy } from "@/lib/format";
import { TX_TYPE_LABELS } from "@/lib/validation/transaction";
import { DeleteButton } from "./DeleteButton";

interface TransactionsSearchParams {
  year?: string;
  asset?: string;
  venue?: string;
  txType?: string;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<TransactionsSearchParams>;
}) {
  const params = await searchParams;
  const assets = await listAssets();

  const conditions = [];
  if (params.year) {
    const y = Number(params.year);
    if (Number.isInteger(y)) {
      const { start, end } = jstYearRange(y);
      conditions.push(gte(transactions.executedAt, start), lt(transactions.executedAt, end));
    }
  }
  if (params.asset) {
    const asset = assets.find((a) => a.symbol === params.asset);
    if (asset) {
      conditions.push(
        or(
          eq(transactions.baseAssetId, asset.id),
          eq(transactions.quoteAssetId, asset.id),
          eq(transactions.feeAssetId, asset.id)
        )
      );
    }
  }
  if (params.venue) {
    conditions.push(eq(transactions.venue, params.venue));
  }
  if (params.txType && (TX_TYPES as readonly string[]).includes(params.txType)) {
    conditions.push(eq(transactions.txType, params.txType as (typeof TX_TYPES)[number]));
  }

  const [rows, yearRows, venueRows] = await Promise.all([
    db.query.transactions.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      with: { baseAsset: true, quoteAsset: true, feeAsset: true },
      orderBy: desc(transactions.executedAt),
      limit: 500,
    }),
    db
      .select({
        year: sql<number>`extract(year from ${transactions.executedAt} at time zone 'Asia/Tokyo')::int`,
      })
      .from(transactions)
      .groupBy(sql`1`)
      .orderBy(sql`1 desc`),
    db.selectDistinct({ venue: transactions.venue }).from(transactions).where(isNotNull(transactions.venue)),
  ]);

  const currentYear = jstYear(new Date());
  const years = Array.from(new Set([currentYear, ...yearRows.map((r) => r.year)])).sort((a, b) => b - a);
  const venues = venueRows
    .map((r) => r.venue)
    .filter((v): v is string => Boolean(v))
    .sort();

  const hasFilter = Boolean(params.year || params.asset || params.venue || params.txType);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">取引一覧</h1>
        <div className="flex items-center gap-3">
          <Link href="/import" className="text-sm text-blue-700 hover:underline">
            CSV取込
          </Link>
          <Link
            href="/transactions/new"
            className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700"
          >
            + 手入力
          </Link>
        </div>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <select name="year" defaultValue={params.year ?? ""} className="rounded border border-gray-300 px-2 py-1">
          <option value="">年(すべて)</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}年
            </option>
          ))}
        </select>
        <select name="asset" defaultValue={params.asset ?? ""} className="rounded border border-gray-300 px-2 py-1">
          <option value="">資産(すべて)</option>
          {assets.map((a) => (
            <option key={a.symbol} value={a.symbol}>
              {a.symbol}
            </option>
          ))}
        </select>
        <select name="venue" defaultValue={params.venue ?? ""} className="rounded border border-gray-300 px-2 py-1">
          <option value="">venue(すべて)</option>
          {venues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select name="txType" defaultValue={params.txType ?? ""} className="rounded border border-gray-300 px-2 py-1">
          <option value="">種別(すべて)</option>
          {TX_TYPES.map((t) => (
            <option key={t} value={t}>
              {TX_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50">
          絞り込み
        </button>
        {hasFilter && (
          <Link href="/transactions" className="px-2 py-1 text-blue-700 hover:underline">
            クリア
          </Link>
        )}
      </form>

      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">日時 (JST)</th>
              <th className="px-3 py-2">種別</th>
              <th className="px-3 py-2">base</th>
              <th className="px-3 py-2">quote</th>
              <th className="px-3 py-2 text-right">円換算額</th>
              <th className="px-3 py-2">price_source</th>
              <th className="px-3 py-2">venue</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tx) => (
              <tr key={tx.id} className="border-t border-gray-100">
                <td className="whitespace-nowrap px-3 py-2">{formatJst(tx.executedAt, "yyyy-MM-dd HH:mm")}</td>
                <td className="px-3 py-2">{TX_TYPE_LABELS[tx.txType as keyof typeof TX_TYPE_LABELS]}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {tx.baseQty} {tx.baseAsset.symbol}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {tx.quoteAsset ? `${tx.quoteQty} ${tx.quoteAsset.symbol}` : "-"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {tx.jpyValue ? formatJpy(tx.jpyValue) : "-"}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">{tx.priceSource ?? "-"}</td>
                <td className="px-3 py-2">{tx.venue ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <Link href={`/transactions/${tx.id}/edit`} className="mr-3 text-xs text-blue-700 hover:underline">
                    編集
                  </Link>
                  <DeleteButton id={tx.id} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-gray-400">
                  該当する取引がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
