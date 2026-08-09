"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ASSET_CLASSES, type AssetClass } from "@/lib/db/schema";
import { createAsset } from "@/app/assets/actions";
import { commitImportAction, dryRunImportAction } from "./actions";
import type { DryRunReport, DryRunRowResult, RowStatus } from "@/lib/csv/dry-run";

const STATUS_LABEL: Record<RowStatus, string> = {
  ok: "OK",
  warning: "警告",
  duplicate: "重複(スキップ予定)",
  error: "エラー",
};

const STATUS_CLASS: Record<RowStatus, string> = {
  ok: "bg-green-100 text-green-800",
  warning: "bg-amber-100 text-amber-800",
  duplicate: "bg-gray-200 text-gray-600",
  error: "bg-red-100 text-red-800",
};

export function ImportClient() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState<string>("");
  const [csvText, setCsvText] = useState<string>("");
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [acknowledgeErrors, setAcknowledgeErrors] = useState(false);
  const [isValidating, startValidating] = useTransition();
  const [isCommitting, startCommitting] = useTransition();
  const [commitMessage, setCommitMessage] = useState<string | null>(null);

  async function runValidation(text: string) {
    startValidating(async () => {
      const result = await dryRunImportAction(text);
      setReport(result);
      setCommitMessage(null);
    });
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setFilename(file.name);
    setCsvText(text);
    setCommitMessage(null);
    await runValidation(text);
  }

  function handleConfirm() {
    startCommitting(async () => {
      const result = await commitImportAction(csvText, filename, acknowledgeErrors);
      if (!result.success) {
        setCommitMessage(`エラー: ${result.error}`);
        return;
      }
      setCommitMessage(`登録 ${result.inserted}件・スキップ ${result.skipped}件`);
      setReport(null);
      setCsvText("");
      setFilename("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    });
  }

  const summary = report?.summary;
  const canConfirm =
    !!report &&
    !report.headerError &&
    (summary!.ok + summary!.warning > 0) &&
    (summary!.error === 0 || acknowledgeErrors);

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium">正規CSVファイル(13列・UTF-8)</label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => void handleFileChange(e)}
          className="mt-1 text-sm"
        />
        {isValidating && <p className="mt-2 text-sm text-gray-500">検証中...</p>}
      </div>

      {commitMessage && (
        <div className="rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          {commitMessage}
        </div>
      )}

      {report?.headerError && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {report.headerError}
        </div>
      )}

      {report && !report.headerError && summary && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded bg-green-100 px-2 py-1 text-green-800">OK {summary.ok}行</span>
            <span className="rounded bg-amber-100 px-2 py-1 text-amber-800">警告 {summary.warning}行</span>
            <span className="rounded bg-gray-200 px-2 py-1 text-gray-600">重複 {summary.duplicate}行</span>
            <span className="rounded bg-red-100 px-2 py-1 text-red-800">エラー {summary.error}行</span>
          </div>

          {report.unknownSymbols.length > 0 && (
            <UnknownSymbolsPanel
              symbols={report.unknownSymbols}
              onAdded={() => void runValidation(csvText)}
            />
          )}

          <div className="max-h-[28rem] overflow-auto rounded border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">行</th>
                  <th className="px-3 py-2">状態</th>
                  <th className="px-3 py-2">日時</th>
                  <th className="px-3 py-2">種別</th>
                  <th className="px-3 py-2">base</th>
                  <th className="px-3 py-2">quote</th>
                  <th className="px-3 py-2">price_source</th>
                  <th className="px-3 py-2 text-right">jpy_value</th>
                  <th className="px-3 py-2">メッセージ</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <ImportRow key={row.rowNumber} row={row} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-4">
            {summary.error > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={acknowledgeErrors}
                  onChange={(e) => setAcknowledgeErrors(e.target.checked)}
                />
                エラー行を除いて登録する
              </label>
            )}
            <button
              type="button"
              disabled={!canConfirm || isCommitting}
              onClick={handleConfirm}
              className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {isCommitting ? "登録中..." : `確定登録 (${summary.ok + summary.warning}件)`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ImportRow({ row }: { row: DryRunRowResult }) {
  const r = row.resolved;
  return (
    <tr className="border-t border-gray-100 align-top">
      <td className="px-3 py-2">{row.rowNumber}</td>
      <td className="px-3 py-2">
        <span className={`rounded px-2 py-0.5 text-xs ${STATUS_CLASS[row.status]}`}>{STATUS_LABEL[row.status]}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-2">{row.raw.executed_at}</td>
      <td className="px-3 py-2">{row.raw.tx_type}</td>
      <td className="whitespace-nowrap px-3 py-2">
        {row.raw.base_symbol} {row.raw.base_qty}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        {row.raw.quote_symbol ? `${row.raw.quote_symbol} ${row.raw.quote_qty}` : "-"}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500">{r?.priceSource ?? "-"}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        {r ? `¥${Number(r.jpyValue).toLocaleString("ja-JP")}` : "-"}
      </td>
      <td className="px-3 py-2 text-xs text-gray-600">{row.messages.join(" / ")}</td>
    </tr>
  );
}

function UnknownSymbolsPanel({ symbols, onAdded }: { symbols: string[]; onAdded: () => void }) {
  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-3">
      <p className="mb-2 text-sm font-medium text-amber-900">
        マスタに無い銘柄があります。追加すると自動で再検証します。
      </p>
      <div className="space-y-2">
        {symbols.map((symbol) => (
          <AddAssetInlineForm key={symbol} symbol={symbol} onAdded={onAdded} />
        ))}
      </div>
    </div>
  );
}

function AddAssetInlineForm({ symbol, onAdded }: { symbol: string; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>("crypto");
  const [ccSymbol, setCcSymbol] = useState(symbol);
  const [trackPrice, setTrackPrice] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  if (added) {
    return <p className="text-sm text-green-700">{symbol} を追加しました</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-white p-2 text-sm">
      <span className="font-mono font-semibold">{symbol}</span>
      <input
        placeholder="name(任意)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-32 rounded border border-gray-300 px-2 py-1"
      />
      <select
        value={assetClass}
        onChange={(e) => setAssetClass(e.target.value as AssetClass)}
        className="rounded border border-gray-300 px-2 py-1"
      >
        {ASSET_CLASSES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input
        placeholder="cc_symbol(任意)"
        value={ccSymbol}
        onChange={(e) => setCcSymbol(e.target.value)}
        className="w-32 rounded border border-gray-300 px-2 py-1"
      />
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={trackPrice} onChange={(e) => setTrackPrice(e.target.checked)} />
        価格取得対象
      </label>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await createAsset({ symbol, name, assetClass, ccSymbol, trackPrice });
            if (!result.success) {
              setError(result.error ?? "追加に失敗しました");
              return;
            }
            setAdded(true);
            onAdded();
          })
        }
        className="rounded bg-gray-900 px-3 py-1 text-xs text-white hover:bg-gray-700 disabled:opacity-50"
      >
        追加
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
