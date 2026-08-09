import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

/**
 * `lib/db/index.ts` の neon-http ドライバは1リクエスト1クエリのHTTP接続であり、
 * drizzleの db.transaction() を呼ぶと "No transactions support in neon-http driver" で
 * 例外になる。§5.2のCSV確定処理はimport_batches行+transactions一括INSERTを
 * アトミックに行う必要があるため、ここだけPool(WebSocket)ベースの接続を使う。
 */
neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const txDb = drizzle(pool, { schema });
