import { describe, expect, it } from "vitest";
import {
  addUtcDays,
  diffUtcDays,
  jstYear,
  jstYearRange,
  toJstDateString,
  toJstIsoString,
  toUtcDateString,
} from "@/lib/datetime";

describe("toUtcDateString / toJstDateString", () => {
  it("§2-5, 受け入れ基準5: noon JST = 03:00 UTC, same calendar day on both sides", () => {
    const d = new Date("2026-08-01T03:00:00.000Z"); // = 2026-08-01T12:00:00+09:00
    expect(toUtcDateString(d)).toBe("2026-08-01");
    expect(toJstDateString(d)).toBe("2026-08-01");
  });

  it("splits calendar days correctly near the UTC/JST boundary", () => {
    // 2026-01-01T23:00:00+09:00 = 2026-01-01T14:00:00Z -> same day both sides
    const d1 = new Date("2026-01-01T14:00:00.000Z");
    expect(toJstDateString(d1)).toBe("2026-01-01");
    expect(toUtcDateString(d1)).toBe("2026-01-01");

    // 2026-01-02T08:00:00+09:00 = 2026-01-01T23:00:00Z -> JST day is ahead of UTC day
    const d2 = new Date("2026-01-01T23:00:00.000Z");
    expect(toUtcDateString(d2)).toBe("2026-01-01");
    expect(toJstDateString(d2)).toBe("2026-01-02");
  });
});

describe("jstYear", () => {
  it("§2-4: 税務年度の帰属は Asia/Tokyo の暦年", () => {
    // 2025-12-31T23:30:00Z = 2026-01-01T08:30:00+09:00 -> JST year is 2026
    expect(jstYear(new Date("2025-12-31T23:30:00.000Z"))).toBe(2026);
  });
});

describe("toJstIsoString", () => {
  it("produces a colon-separated +09:00 offset compatible with executedAtSchema", () => {
    const d = new Date("2026-08-01T03:00:00.000Z");
    expect(toJstIsoString(d)).toBe("2026-08-01T12:00:00+09:00");
  });
});

describe("jstYearRange", () => {
  it("returns the UTC instants bounding a JST calendar year", () => {
    const { start, end } = jstYearRange(2026);
    expect(start.toISOString()).toBe("2025-12-31T15:00:00.000Z");
    expect(end.toISOString()).toBe("2026-12-31T15:00:00.000Z");
    // a transaction at 2026-01-01T08:00:00+09:00 (2025-12-31T23:00Z) should fall inside
    expect(new Date("2025-12-31T23:00:00Z").getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(new Date("2025-12-31T23:00:00Z").getTime()).toBeLessThan(end.getTime());
  });
});

describe("addUtcDays / diffUtcDays", () => {
  it("adds and subtracts calendar days without DST drift", () => {
    expect(addUtcDays("2026-03-01", -3)).toBe("2026-02-26");
    expect(addUtcDays("2026-03-01", 3)).toBe("2026-03-04");
  });

  it("computes day differences", () => {
    expect(diffUtcDays("2026-03-01", "2026-02-26")).toBe(3);
    expect(diffUtcDays("2026-03-01", "2026-03-01")).toBe(0);
  });
});
