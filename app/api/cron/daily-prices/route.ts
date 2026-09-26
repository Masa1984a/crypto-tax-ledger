import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { ingestDailyPrices } from "@/lib/ingest/daily-prices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// §7.3: 自己修復のため毎回直近7日分をupsertする。
//
// cronは2日に1回(vercel.json: "15 0 */2 * *")。CryptoCompareの無料プランは
// 月100コールで、1実行あたり対象資産数ぶん(現状4コール)消費する。毎日実行すると月120コールとなり
// 毎月25日前後に上限へ達して以降の価格更新が止まる(2026-09-26実測: month 134/100、
// hourは9/100で余裕があった)。2日に1回なら月60コールに収まり、手動backfill用の余力も残る。
// 取り込み遅延は最大2日で、§4.1の3日遡及フォールバックの範囲内に収まる。
//
// 資産ごとにtry/catchしているためクォータ超過時は該当資産だけ静かにスキップされ、
// レスポンスは207で返る。停止に気付くには `npm run audit`(daily_pricesの欠損検査)を使う。
const RECENT_DAYS = 7;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.CRYPTOCOMPARE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "CRYPTOCOMPARE_API_KEY is not set" }, { status: 500 });
  }

  try {
    const summaries = await ingestDailyPrices({ kind: "recent", days: RECENT_DAYS }, apiKey);
    const hasError = summaries.some((s) => s.error);
    return NextResponse.json({ ok: !hasError, summaries }, { status: hasError ? 207 : 200 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
