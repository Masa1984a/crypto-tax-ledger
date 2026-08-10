import "../lib/load-env";
import { ingestDailyPrices } from "../lib/ingest/daily-prices";
import { ingestFxRates } from "../lib/ingest/fx-rates";

const FX_ONLY_DEFAULT_DAYS = 30;

function parseArgs(argv: string[]): { from?: string } {
  const fromIndex = argv.indexOf("--from");
  const from = fromIndex !== -1 ? argv[fromIndex + 1] : undefined;
  if (fromIndex !== -1 && (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from))) {
    throw new Error("Usage: npx tsx scripts/backfill.ts [--from YYYY-MM-DD]");
  }
  return { from };
}

async function main() {
  const { from } = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  // §7.3の自動cronはCryptoCompare(daily-prices)側は動いているため、--from省略時は
  // みずほTTM(fx-rates)のみを直近30日分だけ更新する軽量モードにする(手動運用の主用途)。
  // Vercel上からのfx-rates自動cronはみずほ側のWAFに403で拒否されるため実行できず
  // (リージョンをhnd1に固定しても再現、2026-08-10確認)、この手動backfillが正式な更新経路。
  // 過去分を遡って取り込みたい場合や新規資産の価格履歴が必要な場合のみ --from を指定する
  // (この場合はCryptoCompare価格も対象になる)。
  if (!from) {
    console.log(`Fetching recent FX rates only (mizuho, last ${FX_ONLY_DEFAULT_DAYS} days)...\n`);
    const fxSummary = await ingestFxRates({ recentDays: FX_ONLY_DEFAULT_DAYS });
    console.log(
      `  ${String(fxSummary.rowsUpserted).padStart(5)} rows  (${fxSummary.earliestDate} ~ ${fxSummary.latestDate})`
    );
    console.log("\nDone. (Use --from YYYY-MM-DD for a full price+FX historical backfill.)");
    return;
  }

  const apiKey = process.env.CRYPTOCOMPARE_API_KEY;
  if (!apiKey) {
    throw new Error("CRYPTOCOMPARE_API_KEY is not set");
  }

  console.log(`Backfilling from ${from}...\n`);

  console.log("=== Daily prices (CryptoCompare) ===");
  const priceSummaries = await ingestDailyPrices({ kind: "since", fromDate: from }, apiKey);
  for (const s of priceSummaries) {
    if (s.error) {
      console.log(`  ${s.asset.padEnd(6)} ERROR: ${s.error}`);
    } else {
      console.log(`  ${s.asset.padEnd(6)} ${String(s.pointsUpserted).padStart(5)} rows  (${s.earliestDate} ~ ${s.latestDate})`);
    }
  }

  console.log("\n=== FX rates (Mizuho TTM) ===");
  const fxSummary = await ingestFxRates({ sinceDate: from });
  console.log(
    `  ${String(fxSummary.rowsUpserted).padStart(5)} rows  (${fxSummary.earliestDate} ~ ${fxSummary.latestDate})`
  );

  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
