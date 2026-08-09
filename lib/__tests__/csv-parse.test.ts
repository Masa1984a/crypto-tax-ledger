import { describe, expect, it } from "vitest";
import { parseCanonicalCsv } from "@/lib/csv/parse";
import { CANONICAL_CSV_COLUMNS } from "@/lib/csv/canonical";

const HEADER = CANONICAL_CSV_COLUMNS.join(",");

describe("parseCanonicalCsv", () => {
  it("parses the §5.2 sample rows (swap/reward/buy) correctly", () => {
    const csv = [
      HEADER,
      "2026-05-28T09:30:00+09:00,swap,PAXG,0.5,BTC,0.015,,,BTC,0.0001,CowSwap,0xabc,BTC→PAXG入替",
      "2026-08-01T12:00:00+09:00,reward,BASIS,12.34,,,,,,,BASIS,,DRR日次報酬",
      "2026-03-10T21:00:00+09:00,buy,SOL,10,USDC,1450,,,USDC,1.2,KAST,,",
    ].join("\n");

    const result = parseCanonicalCsv(csv);
    expect(result.headerError).toBeUndefined();
    expect(result.rows).toHaveLength(3);
    for (const row of result.rows) {
      expect(row.parseError, `row ${row.rowNumber}: ${row.parseError}`).toBeUndefined();
    }

    expect(result.rows[0].data).toMatchObject({ txType: "swap", baseSymbol: "PAXG", quoteSymbol: "BTC" });
    expect(result.rows[1].data).toMatchObject({ txType: "reward", baseSymbol: "BASIS" });
    expect(result.rows[2].data).toMatchObject({ txType: "buy", baseSymbol: "SOL", quoteSymbol: "USDC" });
    // rowNumber should match actual file line (header=1, so first data row=2)
    expect(result.rows[0].rowNumber).toBe(2);
    expect(result.rows[2].rowNumber).toBe(4);
  });

  it("tolerates a UTF-8 BOM prefix", () => {
    const csv = "﻿" + [HEADER, "2026-08-01T12:00:00+09:00,reward,BASIS,12.34,,,,,,,BASIS,,"].join("\n");
    const result = parseCanonicalCsv(csv);
    expect(result.headerError).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].parseError).toBeUndefined();
  });

  it("reports a header error when required columns are missing", () => {
    const csv = ["executed_at,tx_type,base_symbol,base_qty", "2026-08-01T12:00:00+09:00,reward,BASIS,12.34"].join(
      "\n"
    );
    const result = parseCanonicalCsv(csv);
    expect(result.headerError).toBeDefined();
    expect(result.headerError).toContain("quote_symbol");
  });

  it("受け入れ基準11: executed_atにオフセットが無い行はエラーになる", () => {
    const csv = [HEADER, "2026-08-01T12:00:00,reward,BASIS,12.34,,,,,,,BASIS,,"].join("\n");
    const result = parseCanonicalCsv(csv);
    expect(result.rows[0].parseError).toBeDefined();
  });

  it("buy/sell/swapでquoteが欠けている行はエラーになる", () => {
    const csv = [HEADER, "2026-08-01T12:00:00+09:00,buy,BTC,0.1,,,,,,,,,"].join("\n");
    const result = parseCanonicalCsv(csv);
    expect(result.rows[0].parseError).toBeDefined();
  });

  it("数量のカンマ・全角を除去して受理する", () => {
    const csv = [HEADER, "2026-03-10T21:00:00+09:00,buy,SOL,10,USDC,\"1,450\",,,,,KAST,,"].join("\n");
    const result = parseCanonicalCsv(csv);
    expect(result.rows[0].parseError).toBeUndefined();
    expect(result.rows[0].data?.quoteQty).toBe("1450");
  });

  it("受け入れ基準12: 極小数量でも浮動小数点誤差なく通す", () => {
    const csv = [HEADER, "2026-08-01T12:00:00+09:00,reward,BTC,0.000000000001,,,,,,,,,"].join("\n");
    const result = parseCanonicalCsv(csv);
    expect(result.rows[0].parseError).toBeUndefined();
    expect(result.rows[0].data?.baseQty).toBe("0.000000000001");
  });
});
