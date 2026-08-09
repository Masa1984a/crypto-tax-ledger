"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { assets, transactions, ASSET_CLASSES, type AssetClass } from "@/lib/db/schema";

export interface CreateAssetInput {
  symbol: string;
  name?: string | null;
  assetClass: AssetClass;
  ccSymbol?: string | null;
  trackPrice: boolean;
}

export interface AssetActionResult {
  success: boolean;
  error?: string;
}

export async function createAsset(input: CreateAssetInput): Promise<AssetActionResult> {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) return { success: false, error: "symbolを入力してください" };
  if (!ASSET_CLASSES.includes(input.assetClass)) {
    return { success: false, error: "asset_classが不正です" };
  }

  try {
    await db.insert(assets).values({
      symbol,
      name: input.name?.trim() || null,
      assetClass: input.assetClass,
      ccSymbol: input.ccSymbol?.trim().toUpperCase() || null,
      trackPrice: input.trackPrice,
    });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  revalidatePath("/assets");
  revalidatePath("/import");
  revalidatePath("/transactions/new");
  return { success: true };
}

export async function updateAsset(id: number, input: CreateAssetInput): Promise<AssetActionResult> {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) return { success: false, error: "symbolを入力してください" };

  try {
    await db
      .update(assets)
      .set({
        symbol,
        name: input.name?.trim() || null,
        assetClass: input.assetClass,
        ccSymbol: input.ccSymbol?.trim().toUpperCase() || null,
        trackPrice: input.trackPrice,
      })
      .where(eq(assets.id, id));
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  revalidatePath("/assets");
  return { success: true };
}

/** §5.4: 取引が存在する資産の削除は禁止。 */
export async function deleteAsset(id: number): Promise<AssetActionResult> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(
      sql`${transactions.baseAssetId} = ${id} OR ${transactions.quoteAssetId} = ${id} OR ${transactions.feeAssetId} = ${id}`
    );

  if (count > 0) {
    return { success: false, error: `この資産は${count}件の取引で使用されているため削除できません` };
  }

  await db.delete(assets).where(eq(assets.id, id));
  revalidatePath("/assets");
  return { success: true };
}
