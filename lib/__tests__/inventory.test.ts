import { describe, expect, it } from "vitest";
import { planInventory } from "@/lib/inventory";
import { parseCanonicalCsv } from "@/lib/csv/parse";

describe("planInventory", () => {
  it("turns a shortfall into a fee row taken out of that location (round-trips through the CSV parser)", () => {
    const plan = planInventory("2026-12-31", [
      { symbol: "PAXG", location: "Ledgerで保管", ledgerQty: "1.004993", actualQty: "0.999993" },
    ]);
    expect(plan.errors).toEqual([]);
    expect(plan.shortfalls).toEqual([
      { symbol: "PAXG", location: "Ledgerで保管", ledgerQty: "1.004993", actualQty: "0.999993", diff: "-0.005" },
    ]);

    const parsed = parseCanonicalCsv(plan.csv!);
    expect(parsed.headerError).toBeUndefined();
    expect(parsed.rows).toHaveLength(1);
    const row = parsed.rows[0];
    expect(row.parseError).toBeUndefined();
    expect(row.data).toMatchObject({
      executedAt: "2026-12-31T12:00:00+09:00",
      txType: "fee",
      baseSymbol: "PAXG",
      baseQty: "0.005",
      sourceLocation: "Ledgerで保管",
    });
    expect(row.data?.location).toBeUndefined();
    expect(row.data?.quoteSymbol).toBeUndefined();
  });

  it("lists a surplus for review without booking it (it may be unrecorded income)", () => {
    const plan = planInventory("2026-12-31", [
      { symbol: "SOL", location: "Solanaバリデータで運用中", ledgerQty: "100", actualQty: "100.5" },
    ]);
    expect(plan.surpluses).toEqual([
      { symbol: "SOL", location: "Solanaバリデータで運用中", ledgerQty: "100", actualQty: "100.5", diff: "0.5" },
    ]);
    expect(plan.shortfalls).toEqual([]);
    expect(plan.csv).toBeNull();
  });

  it("skips blank inputs and exact matches; accepts commas/full-width digits in the input", () => {
    const plan = planInventory("2026-12-31", [
      { symbol: "BTC", location: "Tangemに保管", ledgerQty: "0.0534", actualQty: "" },
      { symbol: "ETH", location: "Metamask保管", ledgerQty: "0.02148361", actualQty: "0.02148361" },
      { symbol: "SOL", location: "BASISでステーキング中", ledgerQty: "1000.5", actualQty: "１,０００" },
    ]);
    expect(plan.errors).toEqual([]);
    expect(plan.shortfalls.map((s) => `${s.symbol}:${s.diff}`)).toEqual(["SOL:-0.5"]);
    expect(parseCanonicalCsv(plan.csv!).rows[0].data?.baseQty).toBe("0.5");
  });

  it("quotes values containing commas so the CSV still parses into 15 columns", () => {
    const plan = planInventory("2026-12-31", [
      { symbol: "PAXG", location: "BASIS, 再ステーク", ledgerQty: "0.70466054", actualQty: "0.70356961" },
    ]);
    const parsed = parseCanonicalCsv(plan.csv!);
    expect(parsed.rows[0].parseError).toBeUndefined();
    expect(parsed.rows[0].data?.sourceLocation).toBe("BASIS, 再ステーク");
    expect(parsed.rows[0].data?.baseQty).toBe("0.00109093");
  });

  it("reports invalid or negative input, and refuses to inventory a negative ledger bucket", () => {
    const plan = planInventory("2026-12-31", [
      { symbol: "BTC", location: "Ledgerで保管", ledgerQty: "0.004", actualQty: "abc" },
      { symbol: "BTC", location: "Tangemに保管", ledgerQty: "0.05", actualQty: "-1" },
      { symbol: "PAXG", location: "Ledgerで保管", ledgerQty: "-0.3", actualQty: "0" },
    ]);
    expect(plan.errors).toHaveLength(3);
    expect(plan.csv).toBeNull();
  });

  it("rejects a malformed inventory date", () => {
    const plan = planInventory("2026/12/31", [
      { symbol: "PAXG", location: "Ledgerで保管", ledgerQty: "1", actualQty: "0.9" },
    ]);
    expect(plan.errors).toEqual(["棚卸し日が不正です: 2026/12/31"]);
    expect(plan.csv).toBeNull();
  });
});
