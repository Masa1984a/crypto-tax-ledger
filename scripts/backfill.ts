import "../lib/load-env";
import { ingestDailyPrices } from "../lib/ingest/daily-prices";
import { ingestFxRates } from "../lib/ingest/fx-rates";

function parseArgs(argv: string[]): { from: string } {
  const fromIndex = argv.indexOf("--from");
  const from = fromIndex !== -1 ? argv[fromIndex + 1] : undefined;
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    throw new Error("Usage: npx tsx scripts/backfill.ts --from YYYY-MM-DD");
  }
  return { from };
}

async function main() {
  const { from } = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
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
