import { Decimal } from "@/lib/decimal";
import { toUtcDateString } from "@/lib/datetime";

const HISTODAY_URL = "https://min-api.cryptocompare.com/data/v2/histoday";

export interface CryptoCompareDailyPoint {
  priceDate: string; // YYYY-MM-DD (UTC)
  closeUsd: string;
}

interface HistodayResponse {
  Response: string;
  Message?: string;
  Data: {
    Data: { time: number; close: number }[];
  };
}

/**
 * §7.1: GET .../histoday?fsym={cc_symbol}&tsym=USD&limit={n}&api_key={KEY}
 * `time` はUTC日境界のepoch秒。`close` がその日の終値。
 */
export async function fetchDailyHistory(
  ccSymbol: string,
  limit: number,
  apiKey: string,
  toTs?: number
): Promise<CryptoCompareDailyPoint[]> {
  const url = new URL(HISTODAY_URL);
  url.searchParams.set("fsym", ccSymbol);
  url.searchParams.set("tsym", "USD");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("api_key", apiKey);
  if (toTs !== undefined) {
    url.searchParams.set("toTs", String(toTs));
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`CryptoCompare request failed for ${ccSymbol}: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as HistodayResponse;
  if (json.Response === "Error") {
    throw new Error(`CryptoCompare error for ${ccSymbol}: ${json.Message}`);
  }

  return json.Data.Data.filter((point) => point.close != null).map((point) => ({
    priceDate: toUtcDateString(new Date(point.time * 1000)),
    closeUsd: new Decimal(point.close).toFixed(),
  }));
}

const MAX_PAGES = 20;
const PAGE_LIMIT = 2000;

/**
 * §7.4 バックフィル用: fromDate 以降を必要なだけページングして取得する
 * (histoday は1コールにつき最大2000日分)。
 */
export async function fetchDailyHistorySince(
  ccSymbol: string,
  fromDate: string,
  apiKey: string
): Promise<CryptoCompareDailyPoint[]> {
  const fromTs = Math.floor(new Date(`${fromDate}T00:00:00Z`).getTime() / 1000);
  const collected = new Map<string, CryptoCompareDailyPoint>();
  let toTs: number | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const points = await fetchDailyHistory(ccSymbol, PAGE_LIMIT, apiKey, toTs);
    if (points.length === 0) break;
    for (const point of points) collected.set(point.priceDate, point);

    const earliest = points[0];
    const earliestTs = Math.floor(new Date(`${earliest.priceDate}T00:00:00Z`).getTime() / 1000);
    if (earliestTs <= fromTs) break;
    toTs = earliestTs - 86_400;
  }

  return Array.from(collected.values())
    .filter((point) => point.priceDate >= fromDate)
    .sort((a, b) => (a.priceDate < b.priceDate ? -1 : a.priceDate > b.priceDate ? 1 : 0));
}
