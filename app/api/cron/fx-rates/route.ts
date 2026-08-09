import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { ingestFxRates } from "@/lib/ingest/fx-rates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// §7.3: 自己修復のため毎回直近30日分をupsertする
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
