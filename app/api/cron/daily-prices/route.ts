import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { ingestDailyPrices } from "@/lib/ingest/daily-prices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// §7.3: 自己修復のため毎回直近7日分をupsertする
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
