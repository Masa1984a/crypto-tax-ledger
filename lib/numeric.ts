/**
 * §5.2: 数値はカンマ・全角を除去して受理する。
 * 全角文字(U+FF01-FF5E)はASCII同義字に -0xFEE0 で変換できる(数字・カンマ・ピリオド・マイナス等を含む)。
 */
export function normalizeNumericInput(raw: string): string {
  const halfWidth = raw.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  return halfWidth.replace(/,/g, "").trim();
}
