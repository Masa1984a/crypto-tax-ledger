"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ASSET_CLASSES, type Asset, type AssetClass } from "@/lib/db/schema";
import { createAsset, deleteAsset, updateAsset } from "./actions";

interface EditableFields {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  ccSymbol: string;
  trackPrice: boolean;
}

function toEditable(a: Asset): EditableFields {
  return {
    symbol: a.symbol,
    name: a.name ?? "",
    assetClass: a.assetClass as AssetClass,
    ccSymbol: a.ccSymbol ?? "",
    trackPrice: a.trackPrice,
  };
}

const EMPTY: EditableFields = { symbol: "", name: "", assetClass: "crypto", ccSymbol: "", trackPrice: true };

export function AssetsTable({ assets }: { assets: Asset[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditableFields>(EMPTY);
  const [newDraft, setNewDraft] = useState<EditableFields>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function startEdit(a: Asset) {
    setEditingId(a.id);
    setDraft(toEditable(a));
    setError(null);
  }

  function saveEdit(id: number) {
    startTransition(async () => {
      const result = await updateAsset(id, draft);
      if (!result.success) {
        setError(result.error ?? "更新に失敗しました");
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  }

  function handleDelete(id: number, symbol: string) {
    if (!confirm(`${symbol} を削除します。よろしいですか?`)) return;
    startTransition(async () => {
      const result = await deleteAsset(id);
      if (!result.success) {
        setError(result.error ?? "削除に失敗しました");
        return;
      }
      router.refresh();
    });
  }

  function handleCreate() {
    startTransition(async () => {
      const result = await createAsset(newDraft);
      if (!result.success) {
        setError(result.error ?? "追加に失敗しました");
        return;
      }
      setNewDraft(EMPTY);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">symbol</th>
              <th className="px-3 py-2">name</th>
              <th className="px-3 py-2">asset_class</th>
              <th className="px-3 py-2">cc_symbol</th>
              <th className="px-3 py-2">track_price</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) =>
              editingId === a.id ? (
                <tr key={a.id} className="border-t border-gray-100 bg-blue-50">
                  <td className="px-3 py-2">
                    <input
                      value={draft.symbol}
                      onChange={(e) => setDraft({ ...draft, symbol: e.target.value.toUpperCase() })}
                      className="w-24 rounded border border-gray-300 px-2 py-1"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      className="w-32 rounded border border-gray-300 px-2 py-1"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={draft.assetClass}
                      onChange={(e) => setDraft({ ...draft, assetClass: e.target.value as AssetClass })}
                      className="rounded border border-gray-300 px-2 py-1"
                    >
                      {ASSET_CLASSES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={draft.ccSymbol}
                      onChange={(e) => setDraft({ ...draft, ccSymbol: e.target.value.toUpperCase() })}
                      className="w-24 rounded border border-gray-300 px-2 py-1"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={draft.trackPrice}
                      onChange={(e) => setDraft({ ...draft, trackPrice: e.target.checked })}
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      disabled={isPending}
                      onClick={() => saveEdit(a.id)}
                      className="mr-2 text-xs text-blue-700 hover:underline"
                    >
                      保存
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:underline">
                      キャンセル
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={a.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono">{a.symbol}</td>
                  <td className="px-3 py-2">{a.name ?? "-"}</td>
                  <td className="px-3 py-2">{a.assetClass}</td>
                  <td className="px-3 py-2">{a.ccSymbol ?? "-"}</td>
                  <td className="px-3 py-2">{a.trackPrice ? "✓" : "-"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button onClick={() => startEdit(a)} className="mr-3 text-xs text-blue-700 hover:underline">
                      編集
                    </button>
                    <button
                      disabled={isPending}
                      onClick={() => handleDelete(a.id, a.symbol)}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded border border-gray-200 p-3">
        <p className="mb-2 text-sm font-medium">新規追加</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            placeholder="symbol"
            value={newDraft.symbol}
            onChange={(e) => setNewDraft({ ...newDraft, symbol: e.target.value.toUpperCase() })}
            className="w-24 rounded border border-gray-300 px-2 py-1"
          />
          <input
            placeholder="name(任意)"
            value={newDraft.name}
            onChange={(e) => setNewDraft({ ...newDraft, name: e.target.value })}
            className="w-32 rounded border border-gray-300 px-2 py-1"
          />
          <select
            value={newDraft.assetClass}
            onChange={(e) => setNewDraft({ ...newDraft, assetClass: e.target.value as AssetClass })}
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
            value={newDraft.ccSymbol}
            onChange={(e) => setNewDraft({ ...newDraft, ccSymbol: e.target.value.toUpperCase() })}
            className="w-32 rounded border border-gray-300 px-2 py-1"
          />
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={newDraft.trackPrice}
              onChange={(e) => setNewDraft({ ...newDraft, trackPrice: e.target.checked })}
            />
            価格取得対象
          </label>
          <button
            disabled={isPending || !newDraft.symbol}
            onClick={handleCreate}
            className="rounded bg-gray-900 px-3 py-1.5 text-xs text-white hover:bg-gray-700 disabled:opacity-50"
          >
            追加
          </button>
        </div>
      </div>
    </div>
  );
}
