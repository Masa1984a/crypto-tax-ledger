import "../lib/load-env";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import { txDb } from "../lib/db/transactional";
import { assets, dailyPrices, fxRates, transactions } from "../lib/db/schema";
import {
  computeConversion,
  PricingError,
  type ConversionDeps,
  type ConversionResult,
} from "../lib/pricing/lookup";
import { Decimal } from "../lib/decimal";
import { addUtcDays, diffUtcDays, toUtcDateString } from "../lib/datetime";

/**
 * 参照データとスナップショットの健全性チェック。
 *
 * §2-8 のスナップショット原則により transactions.price_usd/usdjpy/jpy_value は登録時の値で
 * 固定され、参照テーブルを後から更新しても自動では追随しない。そのため
 *   (a) 取引と同じUTC日のうちに登録した行(まだ形成途中の暫定終値を掴む)
 *   (b) daily_close_prev や為替の前営業日フォールバックで登録した行
 * は、後日データが揃った時点で実際の時価とズレたまま残る。このスクリプトはそのズレと、
 * ダッシュボードの鮮度バッジ(§5.5: max(price_date) しか見ない)では検知できない
 * 「参照データ中間の欠損」を洗い出す。
 *
 *   npm run audit           検査のみ(DBは変更しない)
 *   npm run audit -- --fix  base_qty を変えずに直せる行だけ再計算して更新する
 *
 * base_symbol='JPY' の行は base_qty 自体がユーザー入力(実際に受け取った円)である場合が
 * あるため --fix の対象外とし、報告のみ行う。ただしこの台帳には暗号資産での支払いを
 * 「時価から換算」してJPY建て sell として記録する慣行があり、その行の memo には
 * 「時価から換算」または「時価で譲渡」と明記している。この marker を持つ行だけを
 * 参照価格に追随すべき候補として提示する(実際の円売却行を誤検知しないため)。
 */

const DEEMED_FMV_MEMO_MARKER = /時価から換算|時価で譲渡/;

/** 末尾がこの日数以上古いと警告する。daily_prices は日次cron、fx_rates は手動更新。 */
const PRICE_STALE_DAYS = 2;
const FX_STALE_DAYS = 4;

/** fx_rates の平日欠損を個別に列挙する期間。これより古い欠損は祝日とみなして件数のみ表示する。 */
const FX_RECENT_WINDOW_DAYS = 90;

function parseArgs(argv: string[]): { fix: boolean } {
  const unknown = argv.filter((a) => a !== "--fix");
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(" ")}\nUsage: npm run audit [-- --fix]`);
  }
  return { fix: argv.includes("--fix") };
}

/** 参照テーブルを一度だけ読み込み、computeConversion に渡すメモリ上の deps を作る。 */
async function loadReferenceData() {
  const [allAssets, prices, rates] = await Promise.all([
    db.select().from(assets),
    db.select().from(dailyPrices),
    db.select().from(fxRates),
  ]);

  const closesByAsset = new Map<number, Map<string, string>>();
  for (const p of prices) {
    let byDate = closesByAsset.get(p.assetId);
    if (!byDate) closesByAsset.set(p.assetId, (byDate = new Map()));
    byDate.set(p.priceDate, p.closeUsd);
  }
  const sortedRates = [...rates].sort((a, b) => (a.rateDate < b.rateDate ? -1 : 1));

  // §4.1/4.2 と同じ探索をメモリ上で行う(取引数×DB往復を避けるため)
  const deps: ConversionDeps = {
    async lookupUsdJpy(jstDate) {
      let found: string | null = null;
      for (const r of sortedRates) {
        if (r.rateDate > jstDate) break;
        found = r.ttm;
      }
      return found;
    },
    async lookupDailyClose(assetId, utcDate, maxDaysBack) {
      const byDate = closesByAsset.get(assetId);
      if (!byDate) return null;
      for (let back = 0; back <= maxDaysBack; back++) {
        const priceDate = addUtcDays(utcDate, -back);
        const closeUsd = byDate.get(priceDate);
        if (closeUsd) return { closeUsd, priceDate, daysBack: back };
      }
      return null;
    },
  };

  return { allAssets, closesByAsset, sortedRates, deps };
}

type AssetRow = Awaited<ReturnType<typeof loadReferenceData>>["allAssets"][number];

/** 各資産の既存カバー範囲の「内側」の欠損日と、末尾の遅れを報告する。 */
function reportPriceGaps(
  allAssets: AssetRow[],
  closesByAsset: Map<number, Map<string, string>>,
  todayUtc: string
): number {
  console.log("=== 1. daily_prices の欠損 ===");
  let totalMissing = 0;

  for (const asset of allAssets.filter((a) => a.trackPrice && a.ccSymbol)) {
    const byDate = closesByAsset.get(asset.id);
    if (!byDate || byDate.size === 0) {
      console.log(`  ${asset.symbol.padEnd(5)} 価格データが1件もありません`);
      totalMissing++;
      continue;
    }
    const dates = [...byDate.keys()].sort();
    const first = dates[0];
    const last = dates[dates.length - 1];

    const missing: string[] = [];
    for (let d = first; d <= last; d = addUtcDays(d, 1)) {
      if (!byDate.has(d)) missing.push(d);
    }
    totalMissing += missing.length;

    const behind = diffUtcDays(todayUtc, last);
    const gapText = missing.length === 0 ? "欠損なし" : `欠損${missing.length}件: ${missing.join(", ")}`;
    const behindText = behind >= PRICE_STALE_DAYS ? `  [!] 最終日 ${last} (${behind}日前)` : "";
    console.log(`  ${asset.symbol.padEnd(5)} ${first}〜${last}  ${gapText}${behindText}`);
  }

  if (totalMissing === 0) console.log("  -> 問題なし");
  return totalMissing;
}

/** みずほTTMは営業日のみ。土日は正常な欠損なので、平日の欠損(祝日の可能性)だけ報告する。 */
function reportFxGaps(sortedRates: { rateDate: string }[], todayUtc: string): void {
  console.log("\n=== 2. fx_rates の欠損(平日のみ / 土日は仕様上の欠損) ===");
  if (sortedRates.length === 0) {
    console.log("  為替データが1件もありません");
    return;
  }

  const have = new Set(sortedRates.map((r) => r.rateDate));
  const first = sortedRates[0].rateDate;
  const last = sortedRates[sortedRates.length - 1].rateDate;

  const missing: string[] = [];
  for (let d = first; d <= last; d = addUtcDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (!have.has(d)) missing.push(d);
  }

  // 祝日は恒久的に欠損したままなので全件並べても毎回同じノイズになる。
  // 取り込み失敗として対処できるのは直近分だけなので、詳細は直近90日に絞る。
  const recentCutoff = addUtcDays(todayUtc, -FX_RECENT_WINDOW_DAYS);
  const recent = missing.filter((d) => d >= recentCutoff);
  const older = missing.length - recent.length;

  if (missing.length === 0) {
    console.log(`  ${first}〜${last}  平日の欠損なし`);
  } else {
    const recentText =
      recent.length === 0
        ? `直近${FX_RECENT_WINDOW_DAYS}日は欠損なし`
        : `直近${FX_RECENT_WINDOW_DAYS}日の平日欠損: ${recent.join(", ")}`;
    console.log(`  ${first}〜${last}  ${recentText}(過去分の平日欠損 ${older}件は祝日とみなして省略)`);
  }

  const behind = diffUtcDays(todayUtc, last);
  if (behind >= FX_STALE_DAYS) {
    console.log(`  [!] 最終日が${behind}日前です。みずほTTMは手動更新なので npm run backfill を実行してください`);
  }
}

interface DriftRow {
  id: number;
  day: string;
  txType: string;
  label: string;
  storedJpy: string;
  newJpy: string;
  diff: Decimal;
  conversion: ConversionResult;
}

function formatDiff(d: Decimal): string {
  return (d.isNegative() ? "" : "+") + d.toFixed(2);
}

function printDriftRows(rows: DriftRow[], render: (r: DriftRow) => string): void {
  for (const r of [...rows].sort((a, b) => b.diff.abs().comparedTo(a.diff.abs()))) {
    console.log(render(r));
  }
}

async function main() {
  const { fix } = parseArgs(process.argv.slice(2));
  const todayUtc = toUtcDateString(new Date());

  const { allAssets, closesByAsset, sortedRates, deps } = await loadReferenceData();
  const assetById = new Map(allAssets.map((a) => [a.id, a]));
  const assetInfo = (id: number) => {
    const a = assetById.get(id)!;
    return { id: a.id, symbol: a.symbol, assetClass: a.assetClass as "crypto" | "stable" | "fiat" };
  };

  reportPriceGaps(allAssets, closesByAsset, todayUtc);
  reportFxGaps(sortedRates, todayUtc);

  const txs = await db.select().from(transactions).orderBy(transactions.executedAt);

  const fixable: DriftRow[] = [];
  const reviewNeeded: DriftRow[] = [];
  const failures: string[] = [];
  let manualSkipped = 0;
  let actualJpySkipped = 0;

  for (const t of txs) {
    if (t.priceSource === "manual") {
      manualSkipped++; // 明示上書きは検査対象外(§4.1 rule 1)
      continue;
    }
    const base = assetInfo(t.baseAssetId);
    const day = toUtcDateString(t.executedAt);

    try {
      if (base.symbol !== "JPY") {
        const conversion = await computeConversion(
          {
            executedAt: t.executedAt,
            baseAsset: base,
            baseQty: t.baseQty,
            quoteAsset: t.quoteAssetId ? assetInfo(t.quoteAssetId) : null,
            quoteQty: t.quoteQty,
          },
          deps
        );
        const diff = new Decimal(conversion.jpyValue).minus(t.jpyValue ?? "0");
        const priceMoved =
          !new Decimal(conversion.priceUsd).equals(t.priceUsd ?? "0") ||
          !new Decimal(conversion.usdjpy).equals(t.usdjpy ?? "0");
        if (!diff.isZero() || priceMoved) {
          fixable.push({
            id: t.id,
            day,
            txType: t.txType,
            label: base.symbol,
            storedJpy: t.jpyValue ?? "0",
            newJpy: conversion.jpyValue,
            diff,
            conversion,
          });
        }
      } else {
        // base=JPY の行は jpy_value = base_qty(入力値)。対になる暗号資産側の時価と比較する。
        if (!t.quoteAssetId || !t.quoteQty) continue;
        if (!DEEMED_FMV_MEMO_MARKER.test(t.memo ?? "")) {
          actualJpySkipped++; // 実際に受け取った円建て金額とみなす
          continue;
        }
        const crypto = assetInfo(t.quoteAssetId);
        const conversion = await computeConversion(
          {
            executedAt: t.executedAt,
            baseAsset: crypto,
            baseQty: t.quoteQty,
            quoteAsset: null,
            quoteQty: null,
          },
          deps
        );
        const diff = new Decimal(conversion.jpyValue).minus(t.baseQty);
        if (!diff.isZero()) {
          reviewNeeded.push({
            id: t.id,
            day,
            txType: t.txType,
            label: `JPY/${crypto.symbol}`,
            storedJpy: t.baseQty,
            newJpy: conversion.jpyValue,
            diff,
            conversion,
          });
        }
      }
    } catch (err) {
      failures.push(
        `  id=${t.id} ${day} ${base.symbol}: ${err instanceof PricingError ? err.message : String(err)}`
      );
    }
  }

  console.log(`\n=== 3. スナップショットのズレ(自動修正可) ${fixable.length}件 ===`);
  printDriftRows(
    fixable,
    (r) =>
      `  id=${String(r.id).padEnd(4)} ${r.day} ${r.txType.padEnd(6)} ${r.label.padEnd(5)}` +
      ` ¥${Number(r.storedJpy).toLocaleString()} -> ¥${Number(r.newJpy).toLocaleString()}` +
      ` (${formatDiff(r.diff)})  src=${r.conversion.priceSource}`
  );
  if (fixable.length === 0) console.log("  -> ズレなし");

  console.log(`\n=== 4. 要確認: JPY建て行(base_qty が入力値のため自動修正しない) ${reviewNeeded.length}件 ===`);
  printDriftRows(
    reviewNeeded,
    (r) =>
      `  id=${String(r.id).padEnd(4)} ${r.day} ${r.txType.padEnd(6)} ${r.label.padEnd(10)}` +
      ` base_qty ¥${Number(r.storedJpy).toLocaleString()} -> 時価 ¥${Number(r.newJpy).toLocaleString()}` +
      ` (${formatDiff(r.diff)})`
  );
  if (reviewNeeded.length === 0) {
    console.log("  -> ズレなし");
  } else {
    console.log("  ※ 対になる報酬行と金額を揃える必要があるため、修正は個別に判断してください");
    console.log("     (base_qty を変えると row_hash と memo 内の参照値も更新が必要)");
  }

  if (failures.length > 0) {
    console.log(`\n=== 5. 再計算できなかった行 ${failures.length}件 ===`);
    for (const f of failures) console.log(f);
  }

  const totalDiff = fixable.reduce((acc, r) => acc.plus(r.diff), new Decimal(0));
  console.log(
    `\n--- 検査 ${txs.length}行 (manual上書き ${manualSkipped}行 / 実額JPY建て ${actualJpySkipped}行 は対象外) ---`
  );
  console.log(`自動修正可の差額合計: ${formatDiff(totalDiff)} 円`);

  if (!fix) {
    if (fixable.length > 0) console.log("\n修正するには: npm run audit -- --fix");
    return;
  }
  if (fixable.length === 0) {
    console.log("\n--fix: 修正対象がありません");
    return;
  }

  await txDb.transaction(async (tx) => {
    for (const r of fixable) {
      await tx
        .update(transactions)
        .set({
          priceUsd: r.conversion.priceUsd,
          usdjpy: r.conversion.usdjpy,
          jpyValue: r.conversion.jpyValue,
          priceSource: r.conversion.priceSource,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, r.id));
    }
  });
  console.log(`\n--fix: ${fixable.length}行を更新しました(base_qty・row_hash は変更していません)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
