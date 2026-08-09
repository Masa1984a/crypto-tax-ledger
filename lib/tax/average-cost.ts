import { Decimal, roundJpy } from "@/lib/decimal";
import { jstYear } from "@/lib/datetime";
import { computeFeeJpyValue } from "@/lib/pricing/lookup";
import type { TxType } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// §6.1 イベント展開
// ---------------------------------------------------------------------------

export interface ExpandableTransaction {
  id: number;
  executedAt: Date;
  txType: TxType;
  baseSymbol: string;
  baseQty: string;
  quoteSymbol?: string | null;
  quoteQty?: string | null;
  jpyValue: string | null;
  usdjpy: string | null;
  feeSymbol?: string | null;
  feeQty?: string | null;
  feeAssetId?: number | null;
  feeAssetIsStable?: boolean;
}

export interface RawAcquisition {
  symbol: string;
  year: number;
  qty: Decimal;
  costJpy: Decimal;
  txId: number;
}

export interface RawDisposal {
  symbol: string;
  year: number;
  qty: Decimal;
  proceedsJpy: Decimal;
  txId: number;
}

export interface RawRewardIncome {
  year: number;
  jpy: Decimal;
  txId: number;
}

export interface RawFeeExpense {
  year: number;
  jpy: Decimal;
  txId: number;
  assetSymbol: string;
}

export interface ExpansionResult {
  acquisitions: RawAcquisition[];
  disposals: RawDisposal[];
  rewardIncome: RawRewardIncome[];
  feeExpenses: RawFeeExpense[];
  warnings: string[];
}

const JPY_SYMBOL = "JPY";
const EXCHANGE_TYPES = new Set<TxType>(["buy", "sell", "swap"]);

/**
 * fee資産の price_usd(1単位あたりのUSD時価)を解決する。DBの日次終値を要するのでinjectする。
 * stable資産は呼び出し側で1.0を返してよい。実際のJPY換算(§4.4のqty×price×usdjpy)は
 * computeFeeJpyValue()側の純粋計算に任せる(このresolverは価格のlookupのみを担当する)。
 */
export type FeeAssetPriceResolver = (params: {
  feeAssetId: number;
  feeAssetSymbol: string;
  feeAssetIsStable: boolean;
  executedAt: Date;
}) => Promise<Decimal | null>;

/**
 * §6.1: transactionsを取得/譲渡/報酬所得/必要経費のイベントに展開する(DB非依存の純粋ロジック)。
 * fee資産の時価だけはDBの日次終値を要するため、resolveFeeAssetPrice経由で注入する。
 */
export async function expandTransactions(
  txs: ExpandableTransaction[],
  resolveFeeAssetPrice: FeeAssetPriceResolver
): Promise<ExpansionResult> {
  const acquisitions: RawAcquisition[] = [];
  const disposals: RawDisposal[] = [];
  const rewardIncome: RawRewardIncome[] = [];
  const feeExpenses: RawFeeExpense[] = [];
  const warnings: string[] = [];

  const pushAcquisition = (symbol: string, year: number, qty: Decimal, costJpy: Decimal, txId: number) => {
    if (symbol === JPY_SYMBOL) return;
    acquisitions.push({ symbol, year, qty, costJpy, txId });
  };
  const pushDisposal = (symbol: string, year: number, qty: Decimal, proceedsJpy: Decimal, txId: number) => {
    if (symbol === JPY_SYMBOL) return;
    disposals.push({ symbol, year, qty, proceedsJpy, txId });
  };

  for (const tx of txs) {
    const year = jstYear(tx.executedAt);

    if (tx.txType === "transfer_in" || tx.txType === "transfer_out") {
      // §3.1: 数量・原価計算に不参加。fee_qtyがあれば下の共通処理のみ適用される。
    } else if (tx.txType === "fee") {
      // §3.1 例外: baseは「支払った資産」= 時価譲渡 + 同額を必要経費に計上
      if (tx.jpyValue == null) {
        warnings.push(`取引ID ${tx.id}: jpy_valueが無いため計算から除外しました`);
      } else {
        const jpy = new Decimal(tx.jpyValue);
        pushDisposal(tx.baseSymbol, year, new Decimal(tx.baseQty), jpy, tx.id);
        feeExpenses.push({ year, jpy, txId: tx.id, assetSymbol: tx.baseSymbol });
      }
    } else {
      // buy/sell/swap/reward
      if (tx.jpyValue == null) {
        warnings.push(`取引ID ${tx.id}: jpy_valueが無いため計算から除外しました`);
      } else {
        const jpy = new Decimal(tx.jpyValue);
        pushAcquisition(tx.baseSymbol, year, new Decimal(tx.baseQty), jpy, tx.id);

        if (tx.txType === "reward") {
          rewardIncome.push({ year, jpy, txId: tx.id });
        }

        if (EXCHANGE_TYPES.has(tx.txType) && tx.quoteSymbol && tx.quoteSymbol !== JPY_SYMBOL) {
          if (tx.quoteQty == null) {
            warnings.push(`取引ID ${tx.id}: quote_qtyが無いため譲渡計算から除外しました`);
          } else {
            // swapの両建て: baseの取得価額と同じjpy_valueをquoteの譲渡収入としても使う
            pushDisposal(tx.quoteSymbol, year, new Decimal(tx.quoteQty), jpy, tx.id);
          }
        }
      }
    }

    // fee_qty/fee_symbolは全tx_type共通(§3.1: fee_qtyがあればそれのみfeeと同様に展開)
    if (tx.feeQty && tx.feeSymbol && tx.feeAssetId != null) {
      const feeAssetPriceUsd = await resolveFeeAssetPrice({
        feeAssetId: tx.feeAssetId,
        feeAssetSymbol: tx.feeSymbol,
        feeAssetIsStable: tx.feeAssetIsStable ?? false,
        executedAt: tx.executedAt,
      });
      // §4.4: fee_qty × (fee資産のdaily_closeまたはstable=1.0) × 行のusdjpy
      const feeJpy = computeFeeJpyValue(tx.feeQty, feeAssetPriceUsd, tx.usdjpy ?? "0");
      if (feeJpy === null) {
        warnings.push(`取引ID ${tx.id}: fee資産(${tx.feeSymbol})の価格が取得できないため手数料計算から除外しました(数量減のみ反映)`);
      } else {
        pushDisposal(tx.feeSymbol, year, new Decimal(tx.feeQty), feeJpy, tx.id);
        feeExpenses.push({ year, jpy: feeJpy, txId: tx.id, assetSymbol: tx.feeSymbol });
      }
    }
  }

  return { acquisitions, disposals, rewardIncome, feeExpenses, warnings };
}

// ---------------------------------------------------------------------------
// §6.2 年次ロールフォワード(資産ごと)
// ---------------------------------------------------------------------------

export interface AssetYearResult {
  symbol: string;
  year: number;
  openingQty: Decimal;
  openingCostJpy: Decimal;
  acquiredQty: Decimal;
  acquiredCostJpy: Decimal;
  disposedQty: Decimal;
  disposedProceedsJpy: Decimal;
  averageUnitCost: Decimal;
  costOfGoodsSoldJpy: Decimal;
  realizedGainJpy: Decimal;
  closingQty: Decimal;
  closingCostJpy: Decimal;
  rewardIncomeJpy: Decimal;
  feeExpenseJpy: Decimal;
  warnings: string[];
}

function sumDecimal(values: Decimal[]): Decimal {
  return values.reduce((acc, v) => acc.plus(v), new Decimal(0));
}

/**
 * §6.2: 資産ごとに最古の取引年から throughYear まで JST暦年で逐次計算する。
 * 平均単価は年またぎで累積誤差が出ないようフル精度で保持し、JPY金額(取得価額・譲渡原価・
 * 実現損益・期末取得価額)のみ§2-9の規約で小数2位に丸める。
 */
export function computeAverageCostForAsset(params: {
  symbol: string;
  acquisitions: { year: number; qty: Decimal; costJpy: Decimal }[];
  disposals: { year: number; qty: Decimal; proceedsJpy: Decimal }[];
  rewardIncomeByYear: Map<number, Decimal>;
  feeExpenseByYear: Map<number, Decimal>;
  throughYear: number;
}): AssetYearResult[] {
  const { symbol, acquisitions, disposals, rewardIncomeByYear, feeExpenseByYear, throughYear } = params;

  const allYears = [...acquisitions.map((a) => a.year), ...disposals.map((d) => d.year)];
  if (allYears.length === 0) return [];
  const firstYear = Math.min(...allYears);
  if (throughYear < firstYear) return [];

  const results: AssetYearResult[] = [];
  let openingQty = new Decimal(0);
  let openingCost = new Decimal(0);

  for (let year = firstYear; year <= throughYear; year++) {
    const yearAcquisitions = acquisitions.filter((a) => a.year === year);
    const yearDisposals = disposals.filter((d) => d.year === year);

    const acquiredQty = sumDecimal(yearAcquisitions.map((a) => a.qty));
    const acquiredCost = sumDecimal(yearAcquisitions.map((a) => a.costJpy));
    const disposedQty = sumDecimal(yearDisposals.map((d) => d.qty));
    const disposedProceeds = sumDecimal(yearDisposals.map((d) => d.proceedsJpy));

    const warnings: string[] = [];
    const denominator = openingQty.plus(acquiredQty);
    let averageUnitCost = new Decimal(0);
    if (denominator.isZero()) {
      if (!disposedQty.isZero()) {
        warnings.push(`${symbol} ${year}年: 取得も期首残高もない状態で譲渡が発生しています(数量不整合)`);
      }
    } else {
      averageUnitCost = openingCost.plus(acquiredCost).div(denominator);
    }

    const costOfGoodsSold = roundJpy(averageUnitCost.mul(disposedQty));
    const disposedProceedsRounded = roundJpy(disposedProceeds);
    const realizedGain = disposedProceedsRounded.minus(costOfGoodsSold);
    const closingQty = openingQty.plus(acquiredQty).minus(disposedQty);
    if (closingQty.isNegative()) {
      warnings.push(`${symbol} ${year}年: 期末数量がマイナスです(${closingQty.toFixed()})。譲渡数量が保有数量を超えています`);
    }
    const closingCost = roundJpy(averageUnitCost.mul(closingQty));

    results.push({
      symbol,
      year,
      openingQty,
      openingCostJpy: openingCost,
      acquiredQty,
      acquiredCostJpy: roundJpy(acquiredCost),
      disposedQty,
      disposedProceedsJpy: disposedProceedsRounded,
      averageUnitCost,
      costOfGoodsSoldJpy: costOfGoodsSold,
      realizedGainJpy: realizedGain,
      closingQty,
      closingCostJpy: closingCost,
      rewardIncomeJpy: rewardIncomeByYear.get(year) ?? new Decimal(0),
      feeExpenseJpy: feeExpenseByYear.get(year) ?? new Decimal(0),
      warnings,
    });

    openingQty = closingQty;
    openingCost = closingCost;
  }

  return results;
}

// ---------------------------------------------------------------------------
// §6.3 年間サマリ / トップレベルオーケストレーション
// ---------------------------------------------------------------------------

export interface AnnualReport {
  year: number;
  assets: AssetYearResult[]; // その年の各資産の行(§6.4)
  totalRealizedGainJpy: Decimal;
  totalRewardIncomeJpy: Decimal;
  totalFeeExpenseJpy: Decimal;
  miscIncomeJpy: Decimal; // §6.3 雑所得(参考値)
  warnings: string[];
}

function groupSumByYear(items: { year: number; jpy: Decimal }[]): Map<number, Decimal> {
  const map = new Map<number, Decimal>();
  for (const item of items) {
    map.set(item.year, (map.get(item.year) ?? new Decimal(0)).plus(item.jpy));
  }
  return map;
}

/**
 * §6.1-6.3 のオーケストレーション: 展開結果から資産別に最古年〜対象年までロールフォワードし、
 * 対象年のみを抽出してレポートを組み立てる。
 */
export function buildAnnualReport(expansion: ExpansionResult, targetYear: number): AnnualReport {
  const symbols = new Set<string>([
    ...expansion.acquisitions.map((a) => a.symbol),
    ...expansion.disposals.map((d) => d.symbol),
  ]);

  const rewardIncomeBySymbolYear = new Map<string, Map<number, Decimal>>();
  for (const r of expansion.rewardIncome) {
    // reward income is keyed by the acquiring asset; join via acquisitions with same txId
    const acq = expansion.acquisitions.find((a) => a.txId === r.txId);
    if (!acq) continue;
    const bySymbol = rewardIncomeBySymbolYear.get(acq.symbol) ?? new Map<number, Decimal>();
    bySymbol.set(r.year, (bySymbol.get(r.year) ?? new Decimal(0)).plus(r.jpy));
    rewardIncomeBySymbolYear.set(acq.symbol, bySymbol);
  }

  const feeExpenseBySymbolYear = new Map<string, Map<number, Decimal>>();
  for (const f of expansion.feeExpenses) {
    const bySymbol = feeExpenseBySymbolYear.get(f.assetSymbol) ?? new Map<number, Decimal>();
    bySymbol.set(f.year, (bySymbol.get(f.year) ?? new Decimal(0)).plus(f.jpy));
    feeExpenseBySymbolYear.set(f.assetSymbol, bySymbol);
  }

  const assetResults: AssetYearResult[] = [];
  const warnings: string[] = [...expansion.warnings];

  for (const symbol of Array.from(symbols).sort()) {
    const history = computeAverageCostForAsset({
      symbol,
      acquisitions: expansion.acquisitions.filter((a) => a.symbol === symbol),
      disposals: expansion.disposals.filter((d) => d.symbol === symbol),
      rewardIncomeByYear: rewardIncomeBySymbolYear.get(symbol) ?? new Map(),
      feeExpenseByYear: feeExpenseBySymbolYear.get(symbol) ?? new Map(),
      throughYear: targetYear,
    });

    for (const row of history) {
      warnings.push(...row.warnings);
    }

    const targetRow = history.find((r) => r.year === targetYear);
    if (targetRow) {
      assetResults.push(targetRow);
    }
  }

  const totalRealizedGain = sumDecimal(assetResults.map((r) => r.realizedGainJpy));
  const totalRewardIncome = groupSumByYear(expansion.rewardIncome).get(targetYear) ?? new Decimal(0);
  const totalFeeExpense = groupSumByYear(expansion.feeExpenses.map((f) => ({ year: f.year, jpy: f.jpy }))).get(targetYear) ?? new Decimal(0);

  return {
    year: targetYear,
    assets: assetResults,
    totalRealizedGainJpy: totalRealizedGain,
    totalRewardIncomeJpy: totalRewardIncome,
    totalFeeExpenseJpy: totalFeeExpense,
    // §6.3: 雑所得(参考値) = Σ実現損益 + Σ報酬所得 − Σ必要経費(手数料)
    miscIncomeJpy: totalRealizedGain.plus(totalRewardIncome).minus(totalFeeExpense),
    warnings,
  };
}
