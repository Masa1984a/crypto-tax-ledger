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

  it("adds an untagged row (location=null, listed last) so each symbol sums to its holdings", () => {
    const txs: LocationTaggedTransaction[] = [
      { txType: "buy", baseSymbol: "SOL", baseQty: "10", quoteSymbol: "JPY", quoteQty: "150000", location: null },
      { txType: "buy", baseSymbol: "SOL", baseQty: "5", quoteSymbol: "JPY", quoteQty: "75000", location: "BASIS" },
    ];
    expect(rows(txs)).toEqual(["SOL|BASIS|5", "SOL|(タグなし)|10"]);
  });

  it("subtracts the paid quote from source_location (swap out of a Ledger lot)", () => {
    const txs: LocationTaggedTransaction[] = [
      { txType: "buy", baseSymbol: "PAXG", baseQty: "1.4", quoteSymbol: "JPY", quoteQty: "900000", location: "Ledger" },
      {
        txType: "swap",
        baseSymbol: "SOL",
        baseQty: "15",
        quoteSymbol: "PAXG",
        quoteQty: "0.39",
        sourceLocation: "Ledger",
        location: "Validator",
      },
    ];
    expect(rows(txs)).toEqual(["PAXG|Ledger|1.01", "SOL|Validator|15"]);
  });

  it("takes a payment without source_location out of the untagged remainder, which can go negative", () => {
    const txs: LocationTaggedTransaction[] = [
      { txType: "buy", baseSymbol: "PAXG", baseQty: "1", quoteSymbol: "JPY", quoteQty: "600000", location: "Ledger" },
      { txType: "sell", baseSymbol: "JPY", baseQty: "180000", quoteSymbol: "PAXG", quoteQty: "0.3" },
    ];
    // JPY は保有評価と同じく内訳の対象外
    expect(rows(txs)).toEqual(["PAXG|Ledger|1", "PAXG|(タグなし)|-0.3"]);
  });

  it("hides buckets that net to zero (a fully swapped-out asset disappears)", () => {
    const txs: LocationTaggedTransaction[] = [
      { txType: "buy", baseSymbol: "XAUT", baseQty: "0.5", quoteSymbol: "JPY", quoteQty: "330000", location: "Ledger" },
      {
        txType: "swap",
        baseSymbol: "SOL",
        baseQty: "20",
        quoteSymbol: "XAUT",
        quoteQty: "0.5",
        sourceLocation: "Ledger",
        location: "Validator",
      },
    ];
    expect(rows(txs)).toEqual(["SOL|Validator|20"]);
  });

  it("fee rows take the paid base out of source_location (year-end write-off of fee losses)", () => {
    const txs: LocationTaggedTransaction[] = [
      { txType: "buy", baseSymbol: "PAXG", baseQty: "1.004993", quoteSymbol: "JPY", quoteQty: "660000", location: "Ledger" },
      { txType: "fee", baseSymbol: "PAXG", baseQty: "0.005", sourceLocation: "Ledger", location: "ignored" },
    ];
    expect(rows(txs)).toEqual(["PAXG|Ledger|0.999993"]);
  });

  it("transfer moves quantity from source_location to location; its fee comes out of the source", () => {
    const txs: LocationTaggedTransaction[] = [
      { txType: "buy", baseSymbol: "BTC", baseQty: "1", quoteSymbol: "JPY", quoteQty: "15000000", location: "BITPOINT" },
      {
        txType: "transfer_out",
        baseSymbol: "BTC",
        baseQty: "0.4",
        feeSymbol: "BTC",
        feeQty: "0.0001",
        sourceLocation: "BITPOINT",
        location: "Ledger",
      },
    ];
    // 保有数量は transfer で変わらず fee_qty だけ減る(0.9999)ので、タグなしは出ない
    expect(rows(txs)).toEqual(["BTC|BITPOINT|0.5999", "BTC|Ledger|0.4"]);
  });

  it("fee_qty in the received asset comes out of location, in another asset out of source_location", () => {
    const txs: LocationTaggedTransaction[] = [
      { txType: "buy", baseSymbol: "USDC", baseQty: "1000", quoteSymbol: "JPY", quoteQty: "150000", location: "KAST" },
      {
        txType: "buy",
        baseSymbol: "SOL",
        baseQty: "10",
        quoteSymbol: "USDC",
        quoteQty: "1000",
        feeSymbol: "SOL",
        feeQty: "0.01",
        sourceLocation: "KAST",
        location: "Validator",
      },
      { txType: "buy", baseSymbol: "PAXG", baseQty: "1", quoteSymbol: "JPY", quoteQty: "600000", location: "Ledger" },
      {
        txType: "swap",
        baseSymbol: "SOL",
        baseQty: "5",
        quoteSymbol: "PAXG",
        quoteQty: "0.1",
        feeSymbol: "PAXG",
        feeQty: "0.001",
        sourceLocation: "Ledger",
        location: "Validator",
      },
    ];
    expect(rows(txs)).toEqual(["PAXG|Ledger|0.899", "SOL|Validator|14.99"]);
  });
});

function rows(txs: LocationTaggedTransaction[]): string[] {
  return computeLocationBreakdown(txs).map((r) => `${r.symbol}|${r.location ?? "(タグなし)"}|${r.qty.toFixed()}`);
}
