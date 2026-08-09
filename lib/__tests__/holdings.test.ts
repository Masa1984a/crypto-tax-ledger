import { describe, expect, it } from "vitest";
import { computeHoldings, type HoldingsTransaction } from "@/lib/holdings";

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
