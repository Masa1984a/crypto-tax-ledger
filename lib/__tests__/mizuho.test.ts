import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { parseMizuhoCsv } from "@/lib/external/mizuho";

function sjisBuffer(text: string): Buffer {
  return iconv.encode(text, "shift_jis");
}

describe("parseMizuhoCsv", () => {
  it("受け入れ基準7: Shift_JISヘッダを文字化けなくデコードし、USD列を動的に特定する", () => {
    // 日本語ヘッダ(日付)を含む実物形式を模したフィクスチャ。列順は実物と異なってもよい
    // (USD列位置のハードコード禁止を検証するため、あえて先頭ではなく3列目に配置)。
    const csv = ["日付,GBP,USD,EUR", "2026/1/5,182.34,148.5000,155.12", "2026/1/6,182.50,149.0500,155.30"].join(
      "\r\n"
    );
    const rates = parseMizuhoCsv(sjisBuffer(csv));
    expect(rates).toEqual([
      { rateDate: "2026-01-05", ttm: "148.5000" },
      { rateDate: "2026-01-06", ttm: "149.0500" },
    ]);
  });

  it("zero-pads single-digit month/day (YYYY/M/D format)", () => {
    const csv = ["日付,USD", "2026/3/1,150"].join("\n");
    const rates = parseMizuhoCsv(sjisBuffer(csv));
    expect(rates[0].rateDate).toBe("2026-03-01");
  });

  it("skips blank lines and rows with unparseable dates or rates", () => {
    const csv = ["日付,USD", "2026/1/5,150", "", "not-a-date,150", "2026/1/6,not-a-number"].join("\n");
    const rates = parseMizuhoCsv(sjisBuffer(csv));
    expect(rates).toEqual([{ rateDate: "2026-01-05", ttm: "150.0000" }]);
  });

  it("throws a clear error when the USD column is missing", () => {
    const csv = ["日付,GBP,EUR", "2026/1/5,182.34,155.12"].join("\n");
    expect(() => parseMizuhoCsv(sjisBuffer(csv))).toThrow(/USD/);
  });

  it("handles the real file layout: a decorative Japanese-name row before the code row", () => {
    // 実際のquote.csvは1行目が通貨名(日本語)の見出し、2行目が通貨コードの見出しになっている。
    const csv = [
      ",,,参考相場,,",
      ",米ドル,英ポンド,,韓国ウォン,台湾ドル",
      ",USD,GBP,,KRW(100),TWD",
      "2002/4/1,133.15,189.79,,10.12,3.82",
    ].join("\r\n");
    const rates = parseMizuhoCsv(sjisBuffer(csv));
    expect(rates).toEqual([{ rateDate: "2002-04-01", ttm: "133.1500" }]);
  });
});
