import { Decimal } from "@/lib/decimal";
import { toUtcDateString } from "@/lib/datetime";

const HISTODAY_URL = "https://min-api.cryptocompare.com/data/v2/histoday";

/**
 * 無料プランは月100コールに加えて**1秒あたり1コール**の制限がある(2026-10-13 /stats/rate/limit で確認)。
 * 資産ごとの取得を間隔なしで連続して呼ぶと、同じ秒に重なった呼び出しが
 * "You are over your rate limit" で失敗し、その資産の価格だけ静かに更新が止まっていた。
 * 間隔は「前の応答を受け取ってから」数える。送信時刻基準だと、初回だけ接続確立(TLS)の分
 * サーバー到着が遅れ、2本目と1秒以内に届くことがあるため。
 */
export const MIN_REQUEST_GAP_MS = 1100;

let lastResponseAt = 0;
let requestQueue: Promise<unknown> = Promise.resolve();

/** 並行に呼ばれても1本ずつ、前の応答から MIN_REQUEST_GAP_MS 空けて fetch する。 */
function rateLimitedFetch(url: string): Promise<Response> {
  const run = requestQueue.then(async () => {
    const waitMs = lastResponseAt + MIN_REQUEST_GAP_MS - Date.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    try {
      return await fetch(url);
    } finally {
      lastResponseAt = Date.now();
    }
  });
  // 失敗したリクエストで後続が止まらないよう、キューには結果を捨てた Promise を繋ぐ
  requestQueue = run.catch(() => undefined);
  return run;
}

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

  const res = await rateLimitedFetch(url.toString());
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
