import { describe, expect, it } from "vitest";
import {
  checkPriceDeviation,
  computeConversion,
  computeFeeJpyValue,
  PricingError,
  type AssetInfo,
  type ConversionDeps,
  type DailyCloseLookupResult,
} from "@/lib/pricing/lookup";

const BTC: AssetInfo = { id: 1, symbol: "BTC", assetClass: "crypto" };
const PAXG: AssetInfo = { id: 2, symbol: "PAXG", assetClass: "crypto" };
const SOL: AssetInfo = { id: 3, symbol: "SOL", assetClass: "crypto" };
const USDC: AssetInfo = { id: 4, symbol: "USDC", assetClass: "stable" };
const JPY: AssetInfo = { id: 5, symbol: "JPY", assetClass: "fiat" };

/** テスト用フェイク: 為替は日付->TTMのマップから前方フィルで検索する簡易実装。 */
function fakeDeps(opts: {
  fxRates?: Record<string, string>;
  dailyCloses?: Record<string, Record<string, string>>; // symbol-ish key by assetId -> { date: close }
} = {}): ConversionDeps & { calls: { usdjpy: string[]; dailyClose: [number, string, number][] } } {
  const fxRates = opts.fxRates ?? {};
  const dailyCloses = opts.dailyCloses ?? {};
  const calls = { usdjpy: [] as string[], dailyClose: [] as [number, string, number][] };

  return {
    calls,
    async lookupUsdJpy(jstDate: string) {
      calls.usdjpy.push(jstDate);
      const candidates = Object.keys(fxRates)
        .filter((d) => d <= jstDate)
        .sort()
        .reverse();
      return candidates.length > 0 ? fxRates[candidates[0]] : null;
    },
    async lookupDailyClose(assetId: number, utcDate: string, maxDaysBack: number) {
      calls.dailyClose.push([assetId, utcDate, maxDaysBack]);
      const table = dailyCloses[assetId] ?? {};
      for (let back = 0; back <= maxDaysBack; back++) {
        const d = new Date(`${utcDate}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - back);
        const candidate = d.toISOString().slice(0, 10);
        if (table[candidate] !== undefined) {
          const result: DailyCloseLookupResult = { closeUsd: table[candidate], priceDate: candidate, daysBack: back };
          return result;
        }
      }
      return null;
    },
  };
}

describe("computeConversion - explicit overrides", () => {
  it("uses explicit price_usd and usdjpy as-is (source=manual)", async () => {
    const deps = fakeDeps();
    const result = await computeConversion(
      {
        executedAt: new Date("2026-06-01T00:00:00Z"),
        baseAsset: PAXG,
        baseQty: "4.0",
        quoteAsset: BTC,
        quoteQty: "0.05",
        explicitPriceUsd: "200",
        explicitUsdjpy: "150",
      },
      deps
    );
    expect(result.priceSource).toBe("manual");
    expect(result.priceUsd).toBe("200.00000000");
    expect(result.usdjpy).toBe("150.0000");
    // jpy_value = 4.0 * 200 * 150 = 120,000
    expect(result.jpyValue).toBe("120000.00");
    // explicit usdjpy means the fx lookup is never called
    expect(deps.calls.usdjpy).toEqual([]);
  });
});

describe("computeConversion - stable quote derivation (rule 2)", () => {
  it("derives price_usd = quote_qty / base_qty when quote is stable", async () => {
    const deps = fakeDeps({ fxRates: { "2026-03-10": "148.5" } });
    const result = await computeConversion(
      {
        executedAt: new Date("2026-03-10T21:00:00+09:00"),
        baseAsset: SOL,
        baseQty: "10",
        quoteAsset: USDC,
        quoteQty: "1450",
      },
      deps
    );
    expect(result.priceSource).toBe("derived");
    expect(result.priceUsd).toBe("145.00000000");
    expect(result.usdjpy).toBe("148.5000");
  });
});

describe("computeConversion - daily_close (rule 3/4)", () => {
  it("uses same-day daily_close when available (source=daily_close)", async () => {
    const deps = fakeDeps({
      fxRates: { "2026-05-28": "150" },
      dailyCloses: { [PAXG.id]: { "2026-05-28": "2400" } },
    });
    const result = await computeConversion(
      {
        executedAt: new Date("2026-05-28T09:30:00+09:00"),
        baseAsset: PAXG,
        baseQty: "0.5",
        quoteAsset: BTC,
        quoteQty: "0.015",
      },
      deps
    );
    expect(result.priceSource).toBe("daily_close");
    expect(result.priceUsd).toBe("2400.00000000");
  });

  it("falls back up to 3 days back with a warning (source=daily_close_prev)", async () => {
    const deps = fakeDeps({
      fxRates: { "2026-05-25": "150" },
      dailyCloses: { [PAXG.id]: { "2026-05-25": "2350" } }, // 3 days before 05-28
    });
    const result = await computeConversion(
      {
        executedAt: new Date("2026-05-28T09:30:00+09:00"),
        baseAsset: PAXG,
        baseQty: "0.5",
        quoteAsset: BTC,
        quoteQty: "0.015",
      },
      deps
    );
    expect(result.priceSource).toBe("daily_close_prev");
    expect(result.priceUsd).toBe("2350.00000000");
    expect(result.warning).toBeDefined();
  });

  it("throws when no daily_close within 3 days and base is not stable/JPY", async () => {
    const deps = fakeDeps({ fxRates: { "2026-05-28": "150" } });
    await expect(
      computeConversion(
        {
          executedAt: new Date("2026-05-28T09:30:00+09:00"),
          baseAsset: PAXG,
          baseQty: "0.5",
          quoteAsset: BTC,
          quoteQty: "0.015",
        },
        deps
      )
    ).rejects.toThrow(PricingError);
  });
});

describe("computeConversion - stable base fallback (rule 5)", () => {
  it("assumes price_usd=1.0 when base is stable and no daily_close exists", async () => {
    const deps = fakeDeps({ fxRates: { "2026-04-01": "150" } });
    const result = await computeConversion(
      {
        executedAt: new Date("2026-04-01T00:00:00Z"),
        baseAsset: USDC,
        baseQty: "100",
        quoteAsset: SOL,
        quoteQty: "0.5",
      },
      deps
    );
    expect(result.priceSource).toBe("derived");
    expect(result.priceUsd).toBe("1.00000000");
    expect(result.jpyValue).toBe("15000.00"); // 100 * 1.0 * 150
  });
});

describe("computeConversion - JPY leg symmetry", () => {
  it("buy: quote=JPY -> jpy_value=quote_qty directly, price_usd back-derived", async () => {
    const deps = fakeDeps({ fxRates: { "2025-10-01": "150" } });
    const result = await computeConversion(
      {
        executedAt: new Date("2025-10-01T00:00:00+09:00"),
        baseAsset: BTC,
        baseQty: "0.10",
        quoteAsset: JPY,
        quoteQty: "1000000",
      },
      deps
    );
    expect(result.jpyValue).toBe("1000000.00");
    expect(result.priceSource).toBe("derived");
    // price_usd = 1,000,000 / 150 / 0.10 = 66,666.66666667
    expect(result.priceUsd).toBe("66666.66666667");
  });

  it("sell: base=JPY -> jpy_value=base_qty directly, price_usd(JPY)=1/usdjpy", async () => {
    const deps = fakeDeps({ fxRates: { "2026-07-01": "150" } });
    const result = await computeConversion(
      {
        executedAt: new Date("2026-07-01T00:00:00+09:00"),
        baseAsset: JPY,
        baseQty: "1000000",
        quoteAsset: BTC,
        quoteQty: "0.10",
      },
      deps
    );
    expect(result.jpyValue).toBe("1000000.00");
    expect(result.priceSource).toBe("derived");
    expect(result.priceUsd).toBe("0.00666667");
  });

  it("does not query daily_close at all for JPY-leg transactions", async () => {
    const deps = fakeDeps({ fxRates: { "2025-10-01": "150" } });
    await computeConversion(
      {
        executedAt: new Date("2025-10-01T00:00:00+09:00"),
        baseAsset: BTC,
        baseQty: "0.10",
        quoteAsset: JPY,
        quoteQty: "1000000",
      },
      deps
    );
    expect(deps.calls.dailyClose).toEqual([]);
  });
});

describe("computeConversion - date reference keys (受け入れ基準4, 5)", () => {
  it("受け入れ基準5: 2026-08-01T12:00:00+09:00 の reward は price_date/rate_date とも 2026-08-01", async () => {
    const deps = fakeDeps({
      fxRates: { "2026-08-01": "150" },
      dailyCloses: { [BTC.id]: { "2026-08-01": "9000000" } },
    });
    await computeConversion(
      {
        executedAt: new Date("2026-08-01T12:00:00+09:00"),
        baseAsset: BTC,
        baseQty: "1",
      },
      deps
    );
    expect(deps.calls.usdjpy).toEqual(["2026-08-01"]);
    expect(deps.calls.dailyClose[0][1]).toBe("2026-08-01");
  });

  it("受け入れ基準4: 土曜日の executed_at は直前金曜のレートを forward-fill で参照する", async () => {
    // 2026-08-08 is a Saturday (JST). Only Friday 2026-08-07 has a rate.
    const deps = fakeDeps({
      fxRates: { "2026-08-07": "147.25" },
      dailyCloses: { [BTC.id]: { "2026-08-08": "9000000" } },
    });
    const result = await computeConversion(
      {
        executedAt: new Date("2026-08-08T10:00:00+09:00"),
        baseAsset: BTC,
        baseQty: "1",
      },
      deps
    );
    expect(deps.calls.usdjpy).toEqual(["2026-08-08"]);
    expect(result.usdjpy).toBe("147.2500");
  });
});

describe("computeFeeJpyValue", () => {
  it("computes fee jpy value from fee qty, price, and the row's usdjpy", () => {
    const value = computeFeeJpyValue("0.0001", "60000", "150");
    expect(value?.toFixed(2)).toBe("900.00");
  });

  it("returns null when the fee asset price is unavailable", () => {
    expect(computeFeeJpyValue("0.0001", null, "150")).toBeNull();
  });
});

describe("checkPriceDeviation", () => {
  it("flags deviations exceeding the threshold", () => {
    const result = checkPriceDeviation("130", "100");
    expect(result.exceedsThreshold).toBe(true);
    expect(result.deviationPct).toBe("30.00");
  });

  it("does not flag deviations within the threshold", () => {
    const result = checkPriceDeviation("110", "100");
    expect(result.exceedsThreshold).toBe(false);
  });
});
