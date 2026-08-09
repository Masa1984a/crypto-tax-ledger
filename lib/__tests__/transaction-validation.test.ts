import { describe, expect, it } from "vitest";
import { executedAtSchema, transactionInputSchema } from "@/lib/validation/transaction";

const validBuy = {
  executedAt: "2026-03-10T21:00:00+09:00",
  txType: "buy" as const,
  baseSymbol: "sol",
  baseQty: "10",
  quoteSymbol: "usdc",
  quoteQty: "1,450",
  venue: "KAST",
};

describe("executedAtSchema (受け入れ基準11)", () => {
  it("accepts ISO 8601 with a +09:00 offset", () => {
    expect(executedAtSchema.parse("2026-08-01T12:00:00+09:00")).toBe("2026-08-01T12:00:00+09:00");
  });

  it("accepts ISO 8601 with Z", () => {
    expect(executedAtSchema.parse("2026-08-01T03:00:00Z")).toBe("2026-08-01T03:00:00Z");
  });

  it("rejects a datetime string with no timezone offset", () => {
    expect(() => executedAtSchema.parse("2026-08-01T12:00:00")).toThrow();
  });

  it("rejects a date-only string", () => {
    expect(() => executedAtSchema.parse("2026-08-01")).toThrow();
  });
});

describe("transactionInputSchema", () => {
  it("accepts a valid buy row and normalizes symbols/numbers", () => {
    const result = transactionInputSchema.parse(validBuy);
    expect(result.baseSymbol).toBe("SOL");
    expect(result.quoteSymbol).toBe("USDC");
    expect(result.quoteQty).toBe("1450"); // comma stripped
  });

  it("rejects buy/sell/swap without quote", () => {
    const result = transactionInputSchema.safeParse({ ...validBuy, quoteSymbol: undefined, quoteQty: undefined });
    expect(result.success).toBe(false);
  });

  it("rejects reward/fee/transfer rows that include a quote", () => {
    const result = transactionInputSchema.safeParse({
      executedAt: "2026-08-01T12:00:00+09:00",
      txType: "reward",
      baseSymbol: "BASIS",
      baseQty: "12.34",
      quoteSymbol: "USDC",
      quoteQty: "1",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a reward row without quote", () => {
    const result = transactionInputSchema.safeParse({
      executedAt: "2026-08-01T12:00:00+09:00",
      txType: "reward",
      baseSymbol: "BASIS",
      baseQty: "12.34",
    });
    expect(result.success).toBe(true);
  });

  it("requires fee_symbol and fee_qty together", () => {
    const result = transactionInputSchema.safeParse({ ...validBuy, feeQty: "1.2" });
    expect(result.success).toBe(false);
  });

  it("accepts tiny quantities without floating point drift (受け入れ基準12)", () => {
    const result = transactionInputSchema.parse({
      executedAt: "2026-08-01T12:00:00+09:00",
      txType: "reward",
      baseSymbol: "BTC",
      baseQty: "0.000000000001",
    });
    expect(result.baseQty).toBe("0.000000000001");
  });

  it("treats empty-string optional fields as absent (HTML forms submit '' not undefined)", () => {
    const result = transactionInputSchema.safeParse({
      ...validBuy,
      priceUsd: "",
      usdjpy: "",
      feeSymbol: "",
      feeQty: "",
      venue: "",
      txHash: "",
      memo: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priceUsd).toBeUndefined();
      expect(result.data.feeQty).toBeUndefined();
    }
  });

  it("rejects base and quote both being JPY", () => {
    const result = transactionInputSchema.safeParse({
      executedAt: "2026-08-01T12:00:00+09:00",
      txType: "buy",
      baseSymbol: "JPY",
      baseQty: "100",
      quoteSymbol: "JPY",
      quoteQty: "100",
    });
    expect(result.success).toBe(false);
  });
});
