import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { ingestFxRates } from "@/lib/ingest/fx-rates";

/**
 * みずほ quote.csv はAkamai WAFがVercelのサーバーレス関数(データセンターIP)を
 * リージョンを問わず403でブロックするため、自動cronからは実行できないことを確認済み
 * (2026-08-10、hnd1へのリージョン固定後も再現)。そのため vercel.json の crons からは
 * 外し、`npm run backfill` による手動運用に切り替えている。このルート自体は
 * CRON_SECRET保護のまま残し、Vercelダッシュボードからの手動実行や将来の再検証に使う。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECENT_DAYS = 30;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await ingestFxRates({ recentDays: RECENT_DAYS });
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
