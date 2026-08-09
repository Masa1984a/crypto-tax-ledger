import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { fxRates } from "@/lib/db/schema";
import { fetchMizuhoRates, type MizuhoRate } from "@/lib/external/mizuho";
import { addUtcDays, toUtcDateString } from "@/lib/datetime";

export interface FxIngestSummary {
  rowsUpserted: number;
  earliestDate?: string;
  latestDate?: string;
}

const CHUNK_SIZE = 200;

/**
 * §7.2/7.3/7.4: quote.csv は全期間分の1ファイルなので、都度全量取得してから
 * 必要な範囲(直近N日 or --from以降)だけをupsertする。土日祝の穴埋めはしない
 * (参照側の前方フィルで解決、§4.2)。
 */
export async function ingestFxRates(range: { sinceDate?: string; recentDays?: number } = {}): Promise<FxIngestSummary> {
  const all = await fetchMizuhoRates();

  let sinceDate = range.sinceDate;
  if (!sinceDate && range.recentDays !== undefined) {
    sinceDate = addUtcDays(toUtcDateString(new Date()), -range.recentDays);
  }
  const filtered = sinceDate ? all.filter((r) => r.rateDate >= sinceDate!) : all;

  await upsertFxRates(filtered);

  return {
    rowsUpserted: filtered.length,
    earliestDate: filtered[0]?.rateDate,
    latestDate: filtered[filtered.length - 1]?.rateDate,
  };
}

export async function upsertFxRates(rates: MizuhoRate[]): Promise<void> {
  for (let i = 0; i < rates.length; i += CHUNK_SIZE) {
    const chunk = rates.slice(i, i + CHUNK_SIZE);
    if (chunk.length === 0) continue;
    await db
      .insert(fxRates)
      .values(chunk.map((r) => ({ rateDate: r.rateDate, ttm: r.ttm, source: "mizuho" })))
      .onConflictDoUpdate({
        target: fxRates.rateDate,
        set: { ttm: sql`excluded.ttm`, source: sql`excluded.source` },
      });
  }
}
