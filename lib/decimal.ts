import Decimal from "decimal.js";

export { Decimal };

/**
 * §2-9: 円換算額の端数は四捨五入で小数2位。この丸め方を全箇所で統一する。
 */
export function roundJpy(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** price_usd 保存用(小数8位、四捨五入) */
export function roundPriceUsd(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
}

/** usdjpy 保存用(小数4位、四捨五入) */
export function roundUsdJpy(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/** 円単位表示用(小数0位、四捨五入) */
export function roundJpyDisplay(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

export function isPositive(value: Decimal.Value): boolean {
  return new Decimal(value).isPositive() && !new Decimal(value).isZero();
}
