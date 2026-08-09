import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const UTC = "UTC";
export const JST = "Asia/Tokyo";

/**
 * §2-3: 価格参照日 = date(executed_at AT TIME ZONE 'UTC')
 */
export function toUtcDateString(date: Date): string {
  return formatInTimeZone(date, UTC, "yyyy-MM-dd");
}

/**
 * §2-3: 為替参照日 = date(executed_at AT TIME ZONE 'Asia/Tokyo')
 */
export function toJstDateString(date: Date): string {
  return formatInTimeZone(date, JST, "yyyy-MM-dd");
}

/**
 * §2-4: 税務年度の帰属 = executed_at を Asia/Tokyo に変換した暦年
 */
export function jstYear(date: Date): number {
  return Number(formatInTimeZone(date, JST, "yyyy"));
}

export function formatJst(date: Date, formatStr: string): string {
  return formatInTimeZone(date, JST, formatStr);
}

/** JSTオフセット付きのISO 8601文字列("2026-08-01T12:00:00+09:00")に変換する。 */
export function toJstIsoString(date: Date): string {
  return formatInTimeZone(date, JST, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** "YYYY-MM-DD" 文字列に対する暦日単位の加減算(UTC基準、DSTの影響を受けない)。 */
export function addUtcDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toUtcDateString(d);
}

/** JST暦年(§2-4)の範囲を [start, end) のUTC瞬間として返す(年フィルタ用)。 */
export function jstYearRange(year: number): { start: Date; end: Date } {
  return {
    start: fromZonedTime(`${year}-01-01T00:00:00`, JST),
    end: fromZonedTime(`${year + 1}-01-01T00:00:00`, JST),
  };
}

/** 2つの "YYYY-MM-DD" 文字列の差(日数)。 */
export function diffUtcDays(laterDateStr: string, earlierDateStr: string): number {
  const later = new Date(`${laterDateStr}T00:00:00Z`).getTime();
  const earlier = new Date(`${earlierDateStr}T00:00:00Z`).getTime();
  return Math.round((later - earlier) / 86_400_000);
}
