"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";

export interface CancelBatchResult {
  success: boolean;
  deletedCount?: number;
}

/**
 * §5.2 バッチ管理: 「このバッチを取り消す」= DELETE FROM transactions WHERE import_batch_id = X。
 * import_batches行自体は監査記録として残す(何件取り込まれ、後で取り消されたかの履歴)。
 */
export async function cancelBatch(batchId: number): Promise<CancelBatchResult> {
  const deleted = await db
    .delete(transactions)
    .where(eq(transactions.importBatchId, batchId))
    .returning({ id: transactions.id });

  revalidatePath("/import/batches");
  revalidatePath("/transactions");
  revalidatePath("/");
  return { success: true, deletedCount: deleted.length };
}
