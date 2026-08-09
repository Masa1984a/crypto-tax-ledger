import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { dailyPrices, fxRates } from "@/lib/db/schema";
import { addUtcDays, diffUtcDays } from "@/lib/datetime";
import {
  computeConversion,
  type ConversionDeps,
  type ConversionInput,
  type ConversionResult,
  type DailyCloseLookupResult,
} from "./lookup";

export async function lookupUsdJpyFromDb(jstDate: string): Promise<string | null> {
  const rows = await db
    .select({ ttm: fxRates.ttm })
    .from(fxRates)
    .where(lte(fxRates.rateDate, jstDate))
    .orderBy(desc(fxRates.rateDate))
    .limit(1);
  return rows[0]?.ttm ?? null;
}

export async function lookupDailyCloseFromDb(
  assetId: number,
  utcDate: string,
  maxDaysBack: number
): Promise<DailyCloseLookupResult | null> {
  const earliest = addUtcDays(utcDate, -maxDaysBack);
  const rows = await db
    .select({ closeUsd: dailyPrices.closeUsd, priceDate: dailyPrices.priceDate })
    .from(dailyPrices)
    .where(
      and(
        eq(dailyPrices.assetId, assetId),
        lte(dailyPrices.priceDate, utcDate),
        gte(dailyPrices.priceDate, earliest)
      )
    )
    .orderBy(desc(dailyPrices.priceDate))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    closeUsd: row.closeUsd,
    priceDate: row.priceDate,
    daysBack: diffUtcDays(utcDate, row.priceDate),
  };
}

/** 該当UTC日(当日のみ、遡りなし)のdaily_closeを取得する。§5.2の暗黙単価チェック用。 */
export async function lookupSameDayCloseFromDb(
  assetId: number,
  utcDate: string
): Promise<string | null> {
  const found = await lookupDailyCloseFromDb(assetId, utcDate, 0);
  return found?.closeUsd ?? null;
}

export const dbConversionDeps: ConversionDeps = {
  lookupUsdJpy: lookupUsdJpyFromDb,
  lookupDailyClose: lookupDailyCloseFromDb,
};

export function resolveConversion(input: ConversionInput): Promise<ConversionResult> {
  return computeConversion(input, dbConversionDeps);
}
