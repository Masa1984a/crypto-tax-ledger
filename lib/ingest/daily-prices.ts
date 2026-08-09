import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets, dailyPrices } from "@/lib/db/schema";
import { fetchDailyHistory, fetchDailyHistorySince } from "@/lib/external/cryptocompare";

export type DailyPriceIngestMode = { kind: "recent"; days: number } | { kind: "since"; fromDate: string };

export interface DailyPriceIngestSummary {
  asset: string;
  pointsUpserted: number;
  earliestDate?: string;
  latestDate?: string;
  error?: string;
}

const CHUNK_SIZE = 200;

export async function getTrackableAssets() {
  return db
    .select()
    .from(assets)
    .where(and(eq(assets.trackPrice, true), isNotNull(assets.ccSymbol)));
}

/**
 * §7.1/7.3/7.4: 対象は track_price=true AND cc_symbol IS NOT NULL の全資産。
 * `ON CONFLICT (asset_id, price_date) DO UPDATE` で自己修復する。
 */
export async function ingestDailyPrices(
  mode: DailyPriceIngestMode,
  apiKey: string
): Promise<DailyPriceIngestSummary[]> {
  const trackable = await getTrackableAssets();
  const summaries: DailyPriceIngestSummary[] = [];

  for (const asset of trackable) {
    try {
      const points =
        mode.kind === "recent"
          ? await fetchDailyHistory(asset.ccSymbol!, mode.days, apiKey)
          : await fetchDailyHistorySince(asset.ccSymbol!, mode.fromDate, apiKey);

      for (let i = 0; i < points.length; i += CHUNK_SIZE) {
        const chunk = points.slice(i, i + CHUNK_SIZE);
        await db
          .insert(dailyPrices)
          .values(
            chunk.map((p) => ({
              assetId: asset.id,
              priceDate: p.priceDate,
              closeUsd: p.closeUsd,
              source: "cryptocompare",
            }))
          )
          .onConflictDoUpdate({
            target: [dailyPrices.assetId, dailyPrices.priceDate],
            set: { closeUsd: sql`excluded.close_usd`, source: sql`excluded.source`, fetchedAt: sql`now()` },
          });
      }

      summaries.push({
        asset: asset.symbol,
        pointsUpserted: points.length,
        earliestDate: points[0]?.priceDate,
        latestDate: points[points.length - 1]?.priceDate,
      });
    } catch (err) {
      summaries.push({
        asset: asset.symbol,
        pointsUpserted: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summaries;
}
