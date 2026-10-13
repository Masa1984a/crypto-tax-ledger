import { eq, isNotNull, sql } from "drizzle-orm";
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

/**
 * 既存の保管場所タグ(location / source_location の和集合)。入力欄の候補に使う。
 * 内訳は文字列の完全一致で集計するため、表記ゆれがあると別の保管場所として扱われてしまう。
 */
export async function listLocationTags(): Promise<string[]> {
  const [locations, sources] = await Promise.all([
    db.selectDistinct({ tag: transactions.location }).from(transactions).where(isNotNull(transactions.location)),
    db
      .selectDistinct({ tag: transactions.sourceLocation })
      .from(transactions)
      .where(isNotNull(transactions.sourceLocation)),
  ]);
  const tags = [...locations, ...sources].map((r) => r.tag).filter((t): t is string => Boolean(t));
  return Array.from(new Set(tags)).sort();
}
