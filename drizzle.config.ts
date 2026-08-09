import "./lib/load-env";
import { defineConfig } from "drizzle-kit";

// `generate` はDB接続不要。`migrate`/`push`/`studio` 実行時のみ DATABASE_URL が必要。
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
