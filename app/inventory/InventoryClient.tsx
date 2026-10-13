"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { planInventory } from "@/lib/inventory";
import { formatJpy } from "@/lib/format";
import { commitImportAction, dryRunImportAction } from "@/app/import/actions";
import type { DryRunReport, RowStatus } from "@/lib/csv/dry-run";

export interface InventoryRow {
  symbol: string;
  /** null は「タグなし」(棚卸しできない) */
  location: string | null;
  ledgerQty: string;
}

const STATUS_LABEL: Record<RowStatus, string> = {
  ok: "OK",
  warning: "警告",
  duplicate: "登録済み(スキップ)",
  error: "エラー",
};

const rowKey = (symbol: string, location: string) => `${symbol}|${location}`;

export function InventoryClient({ date, rows }: { date: string; rows: InventoryRow[] }) {
  const router = useRouter();
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [checkedCsv, setCheckedCsv] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isChecking, startChecking] = useTransition();
  const [isCommitting, startCommitting] = useTransition();

  const tagged = rows.filter((r): r is InventoryRow & { location: string } => r.location !== null);
  const untagged = rows.filter((r) => r.location === null);

  // 台帳(サーバーから渡される props)と入力から毎回計算し直す。登録後の router.refresh() で台帳が
  // 更新されれば差分は0に戻るので、同じ入力のまま二重に計上されることはない。
  const plan = planInventory(
    date,
    tagged.map((r) => ({
      symbol: r.symbol,
      location: r.location,
      ledgerQty: r.ledgerQty,
      actualQty: actuals[rowKey(r.symbol, r.location)] ?? "",
    }))
  );
  const diffByKey = new Map([...plan.shortfalls, ...plan.surpluses].map((d) => [rowKey(d.symbol, d.location), d.diff]));
  const reportIsCurrent = report !== null && checkedCsv === plan.csv;
  const canCommit =
    reportIsCurrent && report.summary.error === 0 && report.summary.ok + report.summary.warning > 0 && plan.errors.length === 0;

  function handleCheck() {
    const csv = plan.csv;
    if (!csv) return;
    setMessage(null);
    startChecking(async () => {
      setReport(await dryRunImportAction(csv));
      setCheckedCsv(csv);
    });
  }

  function handleCommit() {
    const csv = plan.csv;
    if (!csv) return;
    startCommitting(async () => {
      const result = await commitImportAction(csv, `inventory-${date}.csv`, false);
      if (!result.success) {
        setMessage(`エラー: ${result.error}`);
        return;
      }
      setMessage(`fee 行を${result.inserted}件登録しました(バッチ一覧から取り消せます)`);
      setReport(null);
      setCheckedCsv(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">symbol</th>
              <th className="px-3 py-2">保管場所</th>
              <th className="px-3 py-2 text-right">台帳の数量({date}時点)</th>
              <th className="px-3 py-2">実残高</th>
              <th className="px-3 py-2 text-right">差分</th>
            </tr>
          </thead>
          <tbody>
            {tagged.map((r) => {
              const key = rowKey(r.symbol, r.location);
              const diff = diffByKey.get(key);
              return (
                <tr key={key} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono">{r.symbol}</td>
                  <td className="px-3 py-2">{r.location}</td>
                  <td className="px-3 py-2 text-right">{r.ledgerQty}</td>
                  <td className="px-3 py-2">
                    <input
                      value={actuals[key] ?? ""}
                      onChange={(e) => setActuals((prev) => ({ ...prev, [key]: e.target.value }))}
                      inputMode="decimal"
                      placeholder="未入力なら対象外"
                      aria-label={`${r.symbol} ${r.location} の実残高`}
                      className="w-44 rounded border border-gray-300 px-2 py-1 text-right"
                    />
                  </td>
                  <td
                    className={`px-3 py-2 text-right ${
                      diff === undefined ? "text-gray-400" : diff.startsWith("-") ? "text-red-600" : "text-amber-700"
                    }`}
                  >
                    {diff ?? "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {untagged.length > 0 && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          保管場所が未設定の分(タグなし)は棚卸しできません。先に保管場所・支払元を設定してください:{" "}
          {untagged.map((r) => `${r.symbol} ${r.ledgerQty}`).join(" / ")}
        </p>
      )}

      {plan.errors.length > 0 && (
        <ul className="list-disc rounded border border-red-200 bg-red-50 py-2 pl-8 pr-3 text-xs text-red-700">
          {plan.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {plan.surpluses.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="font-medium">要確認: 台帳より多い保管場所があります(自動では計上しません)</p>
          <p>未記録の報酬・入金(所得になり得ます)や移動の記録漏れの可能性があります。取引を確認してください。</p>
          <ul className="mt-1 list-disc pl-5">
            {plan.surpluses.map((s) => (
              <li key={rowKey(s.symbol, s.location)}>
                {s.symbol} {s.location}: 台帳 {s.ledgerQty} → 実残高 {s.actualQty}(+{s.diff})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleCheck}
          disabled={!plan.csv || plan.errors.length > 0 || isChecking}
          className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {isChecking ? "確認中..." : `目減り分の fee 行を確認(${plan.shortfalls.length}件)`}
        </button>
        <button
          type="button"
          onClick={handleCommit}
          disabled={!canCommit || isCommitting}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {isCommitting ? "登録中..." : "fee 行を登録"}
        </button>
        {report && !reportIsCurrent && (
          <span className="text-xs text-amber-700">入力が変わりました。もう一度確認してください</span>
        )}
        {message && <span className="text-sm text-gray-700">{message}</span>}
      </div>

      {reportIsCurrent && (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">状態</th>
                <th className="px-3 py-2">目減り</th>
                <th className="px-3 py-2">保管場所</th>
                <th className="px-3 py-2 text-right">時価(=必要経費)</th>
                <th className="px-3 py-2">価格の出所</th>
                <th className="px-3 py-2">メッセージ</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.rowNumber} className="border-t border-gray-100">
                  <td className="px-3 py-2">{STATUS_LABEL[r.status]}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.raw.base_qty} {r.raw.base_symbol}
                  </td>
                  <td className="px-3 py-2">{r.raw.source_location}</td>
                  <td className="px-3 py-2 text-right">{r.resolved ? formatJpy(r.resolved.jpyValue) : "-"}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{r.resolved?.priceSource ?? "-"}</td>
                  <td className="px-3 py-2 text-xs">{r.messages.join(" / ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
