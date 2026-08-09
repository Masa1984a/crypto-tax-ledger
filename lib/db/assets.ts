import { eq } from "drizzle-orm";
import { db } from "./index";
import { assets, type Asset } from "./schema";
import type { AssetInfo } from "@/lib/pricing/lookup";

export async function listAssets(): Promise<Asset[]> {
  return db.select().from(assets).orderBy(assets.symbol);
}

export async function getAssetBySymbol(symbol: string): Promise<Asset | undefined> {
  const rows = await db
    .select()
    .from(assets)
    .where(eq(assets.symbol, symbol.toUpperCase()))
    .limit(1);
  return rows[0];
}

export async function getAssetById(id: number): Promise<Asset | undefined> {
  const rows = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  return rows[0];
}

export function toAssetInfo(asset: Asset): AssetInfo {
  return { id: asset.id, symbol: asset.symbol, assetClass: asset.assetClass as AssetInfo["assetClass"] };
}
