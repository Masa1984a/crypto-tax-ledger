import { describe, expect, it } from "vitest";
import { computeRowHash, normNumber } from "@/lib/hash";

describe("normNumber", () => {
  it("strips trailing zeros", () => {
    expect(normNumber("10.500")).toBe("10.5");
  });

  it("strips trailing decimal point", () => {
    expect(normNumber("10.0")).toBe("10");
  });

  it("trims whitespace", () => {
    expect(normNumber("  10.5  ")).toBe("10.5");
  });

  it("never uses exponential notation for tiny numbers", () => {
    expect(normNumber("0.000000000001")).toBe("0.000000000001");
  });

  it("returns empty string for null/undefined/empty", () => {
    expect(normNumber(null)).toBe("");
    expect(normNumber(undefined)).toBe("");
    expect(normNumber("")).toBe("");
  });

  it("accepts numbers too", () => {
    expect(normNumber(10.5)).toBe("10.5");
  });
});

describe("computeRowHash", () => {
  const base = {
    executedAt: new Date("2026-05-28T00:30:00.000Z"),
    txType: "swap",
    baseSymbol: "PAXG",
    baseQty: "0.5",
    quoteSymbol: "BTC",
    quoteQty: "0.015",
    venue: "CowSwap",
    txHash: "0xABC",
  };

  it("is deterministic for identical input", () => {
    expect(computeRowHash(base)).toBe(computeRowHash({ ...base }));
  });

  it("is insensitive to symbol/venue/hash casing", () => {
    const varied = {
      ...base,
      baseSymbol: "paxg",
      quoteSymbol: "btc",
      venue: "cowswap",
      txHash: "0xabc",
    };
    expect(computeRowHash(base)).toBe(computeRowHash(varied));
  });

  it("is insensitive to numeric formatting (trailing zeros, whitespace)", () => {
    const varied = { ...base, baseQty: " 0.5000 ", quoteQty: "0.015000" };
    expect(computeRowHash(base)).toBe(computeRowHash(varied));
  });

  it("ignores millisecond precision (truncates to seconds)", () => {
    const varied = { ...base, executedAt: new Date("2026-05-28T00:30:00.999Z") };
    expect(computeRowHash(base)).toBe(computeRowHash(varied));
  });

  it("changes when executedAt second changes", () => {
    const varied = { ...base, executedAt: new Date("2026-05-28T00:30:01.000Z") };
    expect(computeRowHash(base)).not.toBe(computeRowHash(varied));
  });

  it("changes when base_qty differs", () => {
    const varied = { ...base, baseQty: "0.6" };
    expect(computeRowHash(base)).not.toBe(computeRowHash(varied));
  });

  it("is not affected by price/usdjpy fields (not part of the input type at all)", () => {
    // price_usd/usdjpy/jpy_value are intentionally not part of RowHashInput
    const hash = computeRowHash(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("treats missing quote as empty consistently", () => {
    const reward = {
      executedAt: new Date("2026-08-01T03:00:00.000Z"),
      txType: "reward",
      baseSymbol: "BASIS",
      baseQty: "12.34",
      quoteSymbol: null,
      quoteQty: null,
      venue: "BASIS",
      txHash: null,
    };
    const reward2 = { ...reward, quoteSymbol: undefined, quoteQty: undefined, txHash: undefined };
    expect(computeRowHash(reward)).toBe(computeRowHash(reward2));
  });
});
