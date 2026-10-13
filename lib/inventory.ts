import Papa from "papaparse";
import { Decimal } from "@/lib/decimal";
import { normalizeNumericInput } from "@/lib/numeric";
import { CANONICAL_CSV_COLUMNS, type CanonicalColumn } from "@/lib/csv/canonical";

export interface InventoryEntry {
  symbol: string;
  location: string;
  /** 棚卸し日時点の台帳の数量(保管場所の内訳) */
  ledgerQty: string;
  /** 入力された実残高。空欄の行は棚卸し対象外 */
  actualQty: string;
}

export interface InventoryDiff {
  symbol: string;
  location: string;
  ledgerQty: string;
  actualQty: string;
  /** 実残高 − 台帳(マイナスが目減り) */
  diff: string;
}

export interface InventoryPlan {
  shortfalls: InventoryDiff[];
  surpluses: InventoryDiff[];
  errors: string[];
  /** 目減り分の fee 行の正規CSV。目減りが無ければ null */
  csv: string | null;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function parseQty(raw: string): Decimal | null {
  try {
    const d = new Decimal(normalizeNumericInput(raw));
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/**
 * 棚卸し: 保管場所ごとに実残高と台帳の数量を比べ、目減り分を fee 行(source_location=その保管場所)の
 * 正規CSVにする。fee 行は「時価で譲渡+同額を必要経費」として計算されるので、正味の損失は
 * 平均取得単価×目減り数量になる。台帳より多い分は未記録の受取(=所得)の可能性があるため、
 * 自動では計上せず要確認として返す。
 */
export function planInventory(date: string, entries: InventoryEntry[]): InventoryPlan {
  const shortfalls: InventoryDiff[] = [];
  const surpluses: InventoryDiff[] = [];
  const errors: string[] = [];

  if (!DATE_REGEX.test(date)) {
    return { shortfalls, surpluses, errors: [`棚卸し日が不正です: ${date}`], csv: null };
  }

  for (const e of entries) {
    if (e.actualQty.trim() === "") continue;
    const label = `${e.symbol} ${e.location}`;
    const actual = parseQty(e.actualQty);
    if (!actual || actual.isNegative()) {
      errors.push(`${label}: 実残高は0以上の数値で入力してください`);
      continue;
    }
    const ledger = new Decimal(e.ledgerQty);
    if (ledger.isNegative()) {
      errors.push(`${label}: 台帳の数量がマイナスです。先に保管場所・支払元の設定を直してください`);
      continue;
    }
    const diff = actual.minus(ledger);
    if (diff.isZero()) continue;
    const row = {
      symbol: e.symbol,
      location: e.location,
      ledgerQty: ledger.toFixed(),
      actualQty: actual.toFixed(),
      diff: diff.toFixed(),
    };
    (diff.isNegative() ? shortfalls : surpluses).push(row);
  }

  if (shortfalls.length === 0) return { shortfalls, surpluses, errors, csv: null };

  const data = shortfalls.map((s) => {
    const values: Partial<Record<CanonicalColumn, string>> = {
      // 日付のみのデータと同じく正午JST(UTC/JSTどちらの暦日も一致し、価格・為替の参照日がずれない)
      executed_at: `${date}T12:00:00+09:00`,
      tx_type: "fee",
      base_symbol: s.symbol,
      base_qty: new Decimal(s.diff).negated().toFixed(),
      memo: `棚卸し(${date}): 手数料等による目減り。台帳 ${s.ledgerQty} → 実残高 ${s.actualQty}`,
      source_location: s.location,
    };
    return CANONICAL_CSV_COLUMNS.map((c) => values[c] ?? "");
  });
  const csv = Papa.unparse({ fields: [...CANONICAL_CSV_COLUMNS], data });

  return { shortfalls, surpluses, errors, csv };
}
