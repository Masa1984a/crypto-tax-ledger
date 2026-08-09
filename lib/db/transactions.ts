import { eq, sql } from "drizzle-orm";
import { db } from "./index";
import { transactions } from "./schema";

/**
 * transactions.row_hash はPARTIAL UNIQUE INDEX(WHERE row_hash IS NOT NULL)なので、
 * ON CONFLICTのwhereにも同じ述語を指定しないとPostgresがarbiterとして認識せずエラーになる。
 */
export const rowHashConflictTarget = {
  target: transactions.rowHash,
  where: sql`${transactions.rowHash} IS NOT NULL`,
} as const;

export async function findTransactionByRowHash(rowHash: string) {
  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.rowHash, rowHash))
    .limit(1);
  return rows[0];
}
