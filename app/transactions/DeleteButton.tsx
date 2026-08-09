"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTransaction } from "./actions";

export function DeleteButton({ id }: { id: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!confirm(`取引 ID:${id} を削除します。よろしいですか?`)) return;
        startTransition(async () => {
          await deleteTransaction(id);
          router.refresh();
        });
      }}
      className="text-xs text-red-600 hover:underline disabled:opacity-50"
    >
      削除
    </button>
  );
}
