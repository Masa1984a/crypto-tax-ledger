"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkSetLocation, type LocationBulkFilter } from "./actions";

/** 現在の絞り込み条件に一致する取引へ、まとめて保管場所を設定するパネル。 */
export function BulkLocationPanel({ filter, matchCount }: { filter: LocationBulkFilter; matchCount: number }) {
  const router = useRouter();
  const [location, setLocation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
      <span className="text-blue-900">この絞り込み条件に一致する取引({matchCount}件)の保管場所をまとめて設定:</span>
      <input
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="例: BASISでステーキング中"
        className="min-w-48 rounded border border-gray-300 px-2 py-1"
      />
      <button
        type="button"
        disabled={isPending || !location.trim()}
        onClick={() => {
          if (!confirm(`${matchCount}件の取引の保管場所を「${location.trim()}」に設定します。よろしいですか?`)) return;
          startTransition(async () => {
            const result = await bulkSetLocation(filter, location);
            if (!result.success) {
              setMessage(`エラー: ${result.error}`);
              return;
            }
            setMessage(`${result.updatedCount}件を更新しました`);
            setLocation("");
            router.refresh();
          });
        }}
        className="rounded bg-gray-900 px-3 py-1 text-xs text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {isPending ? "設定中..." : "一括設定"}
      </button>
      {message && <span className="text-xs text-blue-800">{message}</span>}
    </div>
  );
}
