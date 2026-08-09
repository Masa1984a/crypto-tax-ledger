import iconv from "iconv-lite";
import { Decimal } from "@/lib/decimal";

// §7.2: URLは定数化し変更に備える
// 旧URL(.../market/csv/quote.csv)は2023-06-16以降更新が止まった静的アーカイブなので使わないこと。
export const MIZUHO_QUOTE_CSV_URL = "https://www.mizuhobank.co.jp/market/quote.csv";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export interface MizuhoRate {
  rateDate: string; // YYYY-MM-DD
  ttm: string;
}

function parseMizuhoDate(raw: string): string | null {
  const match = raw.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// みずほTTM CSVは数値のみの単純なカンマ区切り(引用符エスケープ不要)。
function splitCsvLine(line: string): string[] {
  return line.split(",");
}

// 実ファイルはヘッダが2行ある(1行目: 通貨名の日本語見出し, 2行目: 通貨コード)。
// 将来レイアウトが変わっても崩れないよう、行位置を決め打ちせず "USD" というセルを
// 持つ最初の行をヘッダ行として動的に探索する。
const HEADER_SEARCH_LIMIT = 5;

/**
 * §7.2: Shift_JISでデコードし、ヘッダ行から "USD" 列を動的に特定する(列位置ハードコード禁止)。
 * 日付列は "YYYY/M/D" 形式で常に先頭列。
 */
export function parseMizuhoCsv(buffer: Buffer): MizuhoRate[] {
  const text = iconv.decode(buffer, "shift_jis");
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    throw new Error("mizuho quote.csv is empty");
  }

  let headerRowIndex = -1;
  let usdIndex = -1;
  for (let i = 0; i < Math.min(HEADER_SEARCH_LIMIT, lines.length); i++) {
    const idx = splitCsvLine(lines[i]).findIndex((cell) => cell.trim().toUpperCase() === "USD");
    if (idx !== -1) {
      headerRowIndex = i;
      usdIndex = idx;
      break;
    }
  }
  if (usdIndex === -1) {
    throw new Error(`mizuho quote.csv: header column "USD" not found in the first ${HEADER_SEARCH_LIMIT} rows`);
  }

  const rates: MizuhoRate[] = [];
  for (const line of lines.slice(headerRowIndex + 1)) {
    const cells = splitCsvLine(line);
    const rateDate = parseMizuhoDate(cells[0] ?? "");
    const rawTtm = cells[usdIndex]?.trim();
    if (!rateDate || !rawTtm) continue;

    let ttm: Decimal;
    try {
      ttm = new Decimal(rawTtm);
    } catch {
      continue;
    }
    if (!ttm.isPositive()) continue;

    rates.push({ rateDate, ttm: ttm.toDecimalPlaces(4).toFixed(4) });
  }
  return rates;
}

export async function fetchMizuhoRates(): Promise<MizuhoRate[]> {
  const res = await fetch(MIZUHO_QUOTE_CSV_URL, {
    headers: { "User-Agent": BROWSER_USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`mizuho quote.csv fetch failed: ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return parseMizuhoCsv(buffer);
}
