import { Decimal, roundJpyDisplay } from "./decimal";

/** §2-9: 表示は円単位に四捨五入。 */
export function formatJpy(value: Decimal.Value): string {
  return `¥${Number(roundJpyDisplay(value).toFixed()).toLocaleString("ja-JP")}`;
}
