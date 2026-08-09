import { desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets, dailyPrices, fxRates, transactions } from "@/lib/db/schema";
import { Decimal, roundJpy } from "@/lib/decimal";
import { diffUtcDays, toUtcDateString } from "@/lib/datetime";
import { computeHoldings, computeLocationBreakdown, type LocationBreakdownRow } from "@/lib/holdings";

export interface HoldingValuation {
  symbol: string;
  qty: Decimal;
  closeUsd: Decimal | null;
  valueUsd: Decimal | null;
  valueJpy: Decimal | null;
}

export interface HoldingsSummary {
  holdings: HoldingValuation[];
  totalValueUsd: Decimal;
  totalValueJpy: Decimal;
  latestUsdjpy: Decimal | null;
}

async function getLatestCloseUsd(assetId: number): Promise<Decimal | null> {
  const rows = await db
    .select({ closeUsd: dailyPrices.closeUsd })
    .from(dailyPrices)
    .where(eq(dailyPrices.assetId, assetId))
    .orderBy(desc(dailyPrices.priceDate))
    .limit(1);
  return rows[0] ? new Decimal(rows[0].closeUsd) : null;
}

/** §5.5: 保有数量 × 最新daily_close × 最新TTM(円・USD併記)。JPYは評価対象から除外する。 */
export async function getHoldingsSummary(): Promise<HoldingsSummary> {
  const rows = await db.query.transactions.findMany({
    with: { baseAsset: true, quoteAsset: true, feeAsset: true },
  });

  const holdingsMap = computeHoldings(
    rows.map((r) => ({
      txType: r.txType as never,
      baseSymbol: r.baseAsset.symbol,
      baseQty: r.baseQty,
      quoteSymbol: r.quoteAsset?.symbol,
      quoteQty: r.quoteQty,
      feeSymbol: r.feeAsset?.symbol,
      feeQty: r.feeQty,
    }))
  );

  const latestRateRows = await db.select().from(fxRates).orderBy(desc(fxRates.rateDate)).limit(1);
  const latestUsdjpy = latestRateRows[0] ? new Decimal(latestRateRows[0].ttm) : null;

  const allAssets = await db.select().from(assets);
  const assetBySymbol = new Map(allAssets.map((a) => [a.symbol, a]));

  const holdings: HoldingValuation[] = [];
  let totalValueUsd = new Decimal(0);
  let totalValueJpy = new Decimal(0);

  for (const [symbol, qty] of holdingsMap.entries()) {
    if (symbol === "JPY") continue;
    if (qty.isZero()) continue;

    const asset = assetBySymbol.get(symbol);
    let closeUsd: Decimal | null = null;
    if (asset?.assetClass === "stable") {
      closeUsd = new Decimal(1);
    } else if (asset) {
      closeUsd = await getLatestCloseUsd(asset.id);
    }

    let valueUsd: Decimal | null = null;
    let valueJpy: Decimal | null = null;
    if (closeUsd) {
      valueUsd = qty.mul(closeUsd);
      totalValueUsd = totalValueUsd.plus(valueUsd);
      if (latestUsdjpy) {
        valueJpy = roundJpy(valueUsd.mul(latestUsdjpy));
        totalValueJpy = totalValueJpy.plus(valueJpy);
      }
    }

    holdings.push({ symbol, qty, closeUsd, valueUsd, valueJpy });
  }

  holdings.sort((a, b) => (b.valueJpy ?? new Decimal(0)).minus(a.valueJpy ?? new Decimal(0)).toNumber());

  return { holdings, totalValueUsd, totalValueJpy: roundJpy(totalValueJpy), latestUsdjpy };
}

/** §5.5拡張: 保管場所タグの内訳(取得ベース・参考値)。 */
export async function getLocationBreakdown(): Promise<LocationBreakdownRow[]> {
  const rows = await db.query.transactions.findMany({
    where: isNotNull(transactions.location),
    with: { baseAsset: true },
  });

  return computeLocationBreakdown(
    rows.map((r) => ({
      txType: r.txType as never,
      baseSymbol: r.baseAsset.symbol,
      baseQty: r.baseQty,
      location: r.location,
    }))
  );
}

export interface DataFreshness {
  latestPriceDate: string | null;
  latestRateDate: string | null;
  priceStaleDays: number | null;
  rateStaleDays: number | null;
}

const STALE_THRESHOLD_DAYS = 2;

export function isStale(days: number | null): boolean {
  return days !== null && days >= STALE_THRESHOLD_DAYS;
}

/** §5.5 データ鮮度バッジ: daily_prices/fx_ratesの最終日を今日と比較する。 */
export async function getDataFreshness(): Promise<DataFreshness> {
  const todayUtc = toUtcDateString(new Date());

  const [latestPrice] = await db
    .select({ priceDate: dailyPrices.priceDate })
    .from(dailyPrices)
    .orderBy(desc(dailyPrices.priceDate))
    .limit(1);
  const [latestRate] = await db.select({ rateDate: fxRates.rateDate }).from(fxRates).orderBy(desc(fxRates.rateDate)).limit(1);

  return {
    latestPriceDate: latestPrice?.priceDate ?? null,
    latestRateDate: latestRate?.rateDate ?? null,
    priceStaleDays: latestPrice ? diffUtcDays(todayUtc, latestPrice.priceDate) : null,
    rateStaleDays: latestRate ? diffUtcDays(todayUtc, latestRate.rateDate) : null,
  };
}
