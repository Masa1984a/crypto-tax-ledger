import { describe, expect, it } from "vitest";
import { normalizeNumericInput } from "@/lib/numeric";

describe("normalizeNumericInput", () => {
  it("strips thousands-separator commas", () => {
    expect(normalizeNumericInput("1,450.00")).toBe("1450.00");
  });

  it("converts full-width digits and punctuation to half-width", () => {
    expect(normalizeNumericInput("１，４５０．５")).toBe("1450.5");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeNumericInput("  10.5  ")).toBe("10.5");
  });

  it("leaves plain ascii numbers untouched", () => {
    expect(normalizeNumericInput("0.000000000001")).toBe("0.000000000001");
  });
});
