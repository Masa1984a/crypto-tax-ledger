import { describe, expect, it } from "vitest";
import { computeHoldings, computeLocationBreakdown, type HoldingsTransaction, type LocationTaggedTransaction } from "@/lib/holdings";

function h(map: Map<string, import("@/lib/decimal").Decimal>, symbol: string): string {
  return map.get(symbol)?.toFixed() ?? "0";
}

describe("computeHoldings", () => {
  it("buy: +base_qty, -quote_qty", () => {
    const txs: HoldingsTransaction[] = [
      { txType: "buy", baseSymbol: "BTC", baseQty: "0.1", quoteSymbol: "JPY", quoteQty: "1000000" },
    ];
    const result = computeHoldings(txs);
    expect(h(result, "BTC")).toBe("0.1");
    expect(h(result, "JPY")).toBe("-1000000");
  });

  it("swap: +base_qty, -quote_qty (both sides tracked)", () => {
    const txs: HoldingsTransaction[] = [
      { txType: "swap", baseSymbol: "PAXG", baseQty: "4", quoteSymbol: "BTC", quoteQty: "0.05" },
    ];
    const result = computeHoldings(txs);
    expect(h(result, "PAXG")).toBe("4");
    expect(h(result, "BTC")).toBe("-0.05");
  });

  it("reward: +base_qty only (no quote)", () => {
    const txs: HoldingsTransaction[] = [{ txType: "reward", baseSymbol: "BASIS", baseQty: "12.34" }];
    const result = computeHoldings(txs);
    expect(h(result, "BASIS")).toBe("12.34");
  });

  it("fee: -base_qty (exception: base is what was paid)", () => {
    const txs: HoldingsTransaction[] = [{ txType: "fee", baseSymbol: "ETH", baseQty: "0.002" }];
    const result = computeHoldings(txs);
    expect(h(result, "ETH")).toBe("-0.002");
  });

  it("transfer_in/transfer_out: base_qty excluded entirely", () => {
    const txs: HoldingsTransaction[] = [
      { txType: "transfer_in", baseSymbol: "ETH", baseQty: "1.5" },
      { txType: "transfer_out", baseSymbol: "ETH", baseQty: "1.5" },
    ];
    const result = computeHoldings(txs);
    expect(result.has("ETH")).toBe(false);
  });

  it("fee_qty on any row type is subtracted, in addition to the main effect", () => {
    const txs: HoldingsTransaction[] = [
      {
        txType: "buy",
        baseSymbol: "SOL",
        baseQty: "10",
        quoteSymbol: "USDC",
        quoteQty: "1450",
        feeSymbol: "USDC",
        feeQty: "1.2",
      },
      { txType: "transfer_out", baseSymbol: "ETH", baseQty: "1.5", feeSymbol: "ETH", feeQty: "0.001" },
    ];
    const result = computeHoldings(txs);
    expect(h(result, "SOL")).toBe("10");
    // USDC: -1450 (quote) - 1.2 (fee) = -1451.2
    expect(h(result, "USDC")).toBe("-1451.2");
    // ETH: transfer_out base excluded, only fee applies -> -0.001
    expect(h(result, "ETH")).toBe("-0.001");
  });

  it("aggregates across multiple transactions for the same symbol", () => {
    const txs: HoldingsTransaction[] = [
      { txType: "buy", baseSymbol: "BTC", baseQty: "0.1", quoteSymbol: "JPY", quoteQty: "1000000" },
      { txType: "buy", baseSymbol: "BTC", baseQty: "0.1", quoteSymbol: "JPY", quoteQty: "1400000" },
      { txType: "swap", baseSymbol: "PAXG", baseQty: "4", quoteSymbol: "BTC", quoteQty: "0.05" },
    ];
    const result = computeHoldings(txs);
    expect(h(result, "BTC")).toBe("0.15"); // 0.1 + 0.1 - 0.05
  });
});

describe("computeLocationBreakdown", () => {
  it("sums base_qty by (symbol, location) for acquisition-type rows only", () => {
    const txs: LocationTaggedTransaction[] = [
      { txType: "buy", baseSymbol: "SOL", baseQty: "70", location: "BASISでステーキング中" },
      { txType: "buy", baseSymbol: "SOL", baseQty: "30", location: "BASISでステーキング中" },
      { txType: "reward", baseSymbol: "SOL", baseQty: "30", location: "Solanaバリデータで運用中" },
      { txType: "reward", baseSymbol: "BTC", baseQty: "1", location: "BASISで再ステーク中" },
      { txType: "reward", baseSymbol: "ETH", baseQty: "0.5", location: "Metamask保管" },
    ];
    const result = computeLocationBreakdown(txs);
    expect(result).toEqual([
      expect.objectContaining({ symbol: "BTC", location: "BASISで再ステーク中" }),
      expect.objectContaining({ symbol: "ETH", location: "Metamask保管" }),
      expect.objectContaining({ symbol: "SOL", location: "BASISでステーキング中" }),
      expect.objectContaining({ symbol: "SOL", location: "Solanaバリデータで運用中" }),
    ]);
    const solStaking = result.find((r) => r.symbol === "SOL" && r.location === "BASISでステーキング中");
    expect(solStaking?.qty.toFixed()).toBe("100");
  });

  it("ignores rows without a location tag", () => {
    const txs: LocationTaggedTransaction[] = [{ txType: "buy", baseSymbol: "SOL", baseQty: "10", location: null }];
    expect(computeLocationBreakdown(txs)).toEqual([]);
  });

  it("ignores non-acquisition tx_types (fee/transfer) even if tagged", () => {
    const txs: LocationTaggedTransaction[] = [
      { txType: "fee", baseSymbol: "ETH", baseQty: "0.01", location: "Metamask" },
      { txType: "transfer_in", baseSymbol: "BTC", baseQty: "1", location: "Ledger" },
    ];
    expect(computeLocationBreakdown(txs)).toEqual([]);
  });
});
