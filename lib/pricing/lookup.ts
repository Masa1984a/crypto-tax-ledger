import type { AssetClass } from "@/lib/db/schema";
import { Decimal, roundJpy, roundPriceUsd, roundUsdJpy } from "@/lib/decimal";
import { toJstDateString, toUtcDateString } from "@/lib/datetime";

export type PriceSource = "manual" | "derived" | "daily_close" | "daily_close_prev";

export const MAX_DAILY_CLOSE_DAYS_BACK = 3;
export const DEVIATION_WARNING_THRESHOLD_PCT = 20;

export class PricingError extends Error {}

export interface AssetInfo {
  id: number;
  symbol: string;
  assetClass: AssetClass;
}

export interface ConversionInput {
  executedAt: Date;
  baseAsset: AssetInfo;
  baseQty: string;
  quoteAsset?: AssetInfo | null;
  quoteQty?: string | null;
  explicitPriceUsd?: string | null;
  explicitUsdjpy?: string | null;
}

export interface DailyCloseLookupResult {
  closeUsd: string;
  priceDate: string;
  daysBack: number;
}

export interface ConversionDeps {
  /** §4.2: rate_date <= jstDate の直近1件の ttm を返す(前方フィル)。無ければ null。 */
  lookupUsdJpy: (jstDate: string) => Promise<string | null>;
  /** §4.1 rule 3/4: utcDate から最大 maxDaysBack 日遡って直近の daily_close を返す。無ければ null。 */
  lookupDailyClose: (
    assetId: number,
    utcDate: string,
    maxDaysBack: number
  ) => Promise<DailyCloseLookupResult | null>;
}

export interface ConversionResult {
  priceUsd: string;
  usdjpy: string;
  jpyValue: string;
  priceSource: PriceSource;
  warning?: string;
}

/**
 * §4 円換算・価格補完ロジック。DB非依存の純粋関数(deps経由でデータを注入)。
 *
 * quote_symbol='JPY' (例: JPYで買った) と base_symbol='JPY' (例: JPYで売った) は
 * 対称に扱う: どちらか一方がJPYならその数量がそのまま jpy_value になり、
 * もう一方(暗号資産側)の price_usd はそこから逆算する。§4.3 はbuy方向の例のみ
 * 明記しているが、buy/sell/swapは計算エンジン上同一処理(§3.1)であるため、
 * sell方向(base=JPY)にも同じロジックを対称適用する。
 */
export async function computeConversion(
  input: ConversionInput,
  deps: ConversionDeps
): Promise<ConversionResult> {
  const baseQty = new Decimal(input.baseQty);
  const quoteQty = input.quoteQty != null && input.quoteQty !== "" ? new Decimal(input.quoteQty) : null;
  const explicitPrice =
    input.explicitPriceUsd != null && input.explicitPriceUsd !== ""
      ? new Decimal(input.explicitPriceUsd)
      : null;

  // §4.2 usdjpy
  let usdjpy: Decimal;
  if (input.explicitUsdjpy != null && input.explicitUsdjpy !== "") {
    usdjpy = new Decimal(input.explicitUsdjpy);
  } else {
    const jstDate = toJstDateString(input.executedAt);
    const rate = await deps.lookupUsdJpy(jstDate);
    if (!rate) {
      throw new PricingError(
        `為替レートが見つかりません(${jstDate}以前のfx_ratesが空です)。usdjpyを明示指定するか、fx_ratesにデータを登録してください。`
      );
    }
    usdjpy = new Decimal(rate);
  }

  let priceUsd: Decimal;
  let priceSource: PriceSource;
  let jpyValue: Decimal;
  let warning: string | undefined;

  if (input.quoteAsset?.symbol === "JPY") {
    if (quoteQty === null) {
      throw new PricingError("quote_symbol=JPYの場合、quote_qtyが必須です。");
    }
    jpyValue = roundJpy(quoteQty);
    if (explicitPrice) {
      priceUsd = explicitPrice;
      priceSource = "manual";
    } else {
      priceUsd = jpyValue.div(usdjpy).div(baseQty);
      priceSource = "derived";
    }
  } else if (input.baseAsset.symbol === "JPY") {
    jpyValue = roundJpy(baseQty);
    if (explicitPrice) {
      priceUsd = explicitPrice;
      priceSource = "manual";
    } else {
      priceUsd = new Decimal(1).div(usdjpy);
      priceSource = "derived";
    }
  } else {
    const resolved = await resolvePriceUsdGeneral(input, baseQty, quoteQty, explicitPrice, deps);
    priceUsd = resolved.priceUsd;
    priceSource = resolved.priceSource;
    warning = resolved.warning;
    jpyValue = roundJpy(baseQty.mul(priceUsd).mul(usdjpy));
  }

  return {
    priceUsd: roundPriceUsd(priceUsd).toFixed(8),
    usdjpy: roundUsdJpy(usdjpy).toFixed(4),
    jpyValue: jpyValue.toFixed(2),
    priceSource,
    warning,
  };
}

/**
 * §4.1 price_usd の決定順位(quote/base どちらもJPYでない一般ケース)。
 * 1. 明示指定 → 'manual'
 * 2. quoteがstable → quote_qty÷base_qty → 'derived'
 * 3. daily_prices の該当UTC日終値 → 'daily_close'
 * 4. 最大3日遡って直近終値 → 'daily_close_prev'(警告付き)
 * 5. baseがstable → 1.0とみなす → 'derived'(実データが無い場合のフォールバック)
 * 6. どれも決定できない → エラー
 */
async function resolvePriceUsdGeneral(
  input: ConversionInput,
  baseQty: Decimal,
  quoteQty: Decimal | null,
  explicitPrice: Decimal | null,
  deps: ConversionDeps
): Promise<{ priceUsd: Decimal; priceSource: PriceSource; warning?: string }> {
  if (explicitPrice) {
    return { priceUsd: explicitPrice, priceSource: "manual" };
  }

  if (input.quoteAsset && input.quoteAsset.assetClass === "stable") {
    if (quoteQty === null) {
      throw new PricingError("quote資産がstableの場合、quote_qtyが必須です。");
    }
    return { priceUsd: quoteQty.div(baseQty), priceSource: "derived" };
  }

  const utcDate = toUtcDateString(input.executedAt);
  const found = await deps.lookupDailyClose(input.baseAsset.id, utcDate, MAX_DAILY_CLOSE_DAYS_BACK);
  if (found) {
    if (found.daysBack === 0) {
      return { priceUsd: new Decimal(found.closeUsd), priceSource: "daily_close" };
    }
    return {
      priceUsd: new Decimal(found.closeUsd),
      priceSource: "daily_close_prev",
      warning: `${utcDate} の daily_close が無いため ${found.daysBack} 日前(${found.priceDate})の終値を使用しました。`,
    };
  }

  if (input.baseAsset.assetClass === "stable") {
    return { priceUsd: new Decimal(1), priceSource: "derived" };
  }

  throw new PricingError(
    `${input.baseAsset.symbol} の price_usd を自動決定できません。price_usd を明示指定してください。`
  );
}

/** §4.4 手数料の円換算。fee資産の価格が取れない場合は null(呼び出し側で警告・経費計算から除外)。 */
export function computeFeeJpyValue(
  feeQty: Decimal.Value,
  feeAssetPriceUsd: Decimal.Value | null,
  rowUsdjpy: Decimal.Value
): Decimal | null {
  if (feeAssetPriceUsd === null) return null;
  return roundJpy(new Decimal(feeQty).mul(feeAssetPriceUsd).mul(rowUsdjpy));
}

export interface DeviationCheckResult {
  deviationPct: string;
  exceedsThreshold: boolean;
  referenceCloseUsd: string;
}

/**
 * §5.2 暗黙単価チェック: 導出単価(derived/manual)と該当日のdaily_closeを比較し、
 * ±20%を超える乖離を警告する(ブロックしない)。
 */
export function checkPriceDeviation(
  priceUsd: Decimal.Value,
  referenceCloseUsd: Decimal.Value,
  thresholdPct: number = DEVIATION_WARNING_THRESHOLD_PCT
): DeviationCheckResult {
  const price = new Decimal(priceUsd);
  const reference = new Decimal(referenceCloseUsd);
  const deviation = price.minus(reference).div(reference).abs().mul(100);
  return {
    deviationPct: deviation.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
    exceedsThreshold: deviation.greaterThan(thresholdPct),
    referenceCloseUsd: reference.toFixed(),
  };
}
