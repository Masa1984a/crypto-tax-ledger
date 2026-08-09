"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelBatch } from "./actions";

export function CancelBatchButton({ batchId, rowCount }: { batchId: number; rowCount: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!confirm(`バッチ #${batchId} を取り消します。取り込まれた最大${rowCount}件の取引が削除されます。よろしいですか?`))
          return;
        startTransition(async () => {
          const result = await cancelBatch(batchId);
          alert(`${result.deletedCount ?? 0}件の取引を削除しました`);
          router.refresh();
        });
      }}
      className="text-xs text-red-600 hover:underline disabled:opacity-50"
    >
      このバッチを取り消す
    </button>
  );
}
