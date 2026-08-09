import "../lib/load-env";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { assets } from "../lib/db/schema";

// §3.3 シードデータ
const SEED_ASSETS: (typeof assets.$inferInsert)[] = [
  { symbol: "BTC", assetClass: "crypto", ccSymbol: "BTC", trackPrice: true },
  { symbol: "ETH", assetClass: "crypto", ccSymbol: "ETH", trackPrice: true },
  { symbol: "PAXG", assetClass: "crypto", ccSymbol: "PAXG", trackPrice: true },
  { symbol: "SOL", assetClass: "crypto", ccSymbol: "SOL", trackPrice: true },
  { symbol: "USDC", assetClass: "stable", ccSymbol: "USDC", trackPrice: false },
  { symbol: "USDT", assetClass: "stable", ccSymbol: "USDT", trackPrice: false },
  { symbol: "JPY", assetClass: "fiat", ccSymbol: null, trackPrice: false },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  const client = neon(process.env.DATABASE_URL);
  const db = drizzle(client, { schema });

  for (const asset of SEED_ASSETS) {
    await db
      .insert(assets)
      .values(asset)
      .onConflictDoUpdate({
        target: assets.symbol,
        set: {
          assetClass: sql`excluded.asset_class`,
          ccSymbol: sql`excluded.cc_symbol`,
          trackPrice: sql`excluded.track_price`,
        },
      });
  }

  const rows = await db.select().from(assets);
  console.log(`Seed complete. ${rows.length} assets in table:`);
  for (const row of rows) {
    console.log(
      `  ${row.symbol.padEnd(6)} class=${row.assetClass.padEnd(7)} cc_symbol=${String(row.ccSymbol).padEnd(6)} track_price=${row.trackPrice}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
