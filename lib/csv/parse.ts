import Papa from "papaparse";
import { transactionInputSchema, type TransactionInput } from "@/lib/validation/transaction";
import { CANONICAL_CSV_COLUMNS, mapCsvRowToSchemaInput } from "./canonical";

export interface ParsedCsvRow {
  rowNumber: number; // 1-indexed file line number (header row = 1)
  raw: Record<string, string>;
  parseError?: string;
  data?: TransactionInput;
}

export interface CsvParseResult {
  rows: ParsedCsvRow[];
  headerError?: string;
}

/**
 * §5.2 正規CSVのパース(DB非依存)。UTF-8/BOM許容はPapa Parseが処理する。
 * 列の過不足はここで検出し、行ごとのバリデーションはlib/validation/transactionを再利用する
 * (手入力フォームと同一のZodスキーマ、というM3の規約をCSV側にもそのまま適用する)。
 */
export function parseCanonicalCsv(csvText: string): CsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const actualColumns = parsed.meta.fields ?? [];
  const missing = CANONICAL_CSV_COLUMNS.filter((c) => !actualColumns.includes(c));
  if (missing.length > 0) {
    return {
      rows: [],
      headerError: `必須列が不足しています: ${missing.join(", ")}(正規フォーマットは13列: ${CANONICAL_CSV_COLUMNS.join(",")})`,
    };
  }

  const rows: ParsedCsvRow[] = parsed.data.map((raw, idx) => {
    const rowNumber = idx + 2; // +1: 0-index -> 1-index, +1: header row
    const mapped = mapCsvRowToSchemaInput(raw);
    const result = transactionInputSchema.safeParse(mapped);
    if (!result.success) {
      return {
        rowNumber,
        raw,
        parseError: result.error.issues.map((i) => i.message).join(" / "),
      };
    }
    return { rowNumber, raw, data: result.data };
  });

  return { rows };
}
