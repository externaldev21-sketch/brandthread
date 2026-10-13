/**
 * Buyer-local time for scheduled retention pushes (weekly digest, order
 * anniversary). Pure: no database, no clock — callers pass `now`.
 *
 * Resolution order (first valid IANA name wins):
 *   1. users.timezone            device timezone sent with the push token
 *   2. thread_cash_streaks.timezone   reported by the Thread Cash check-in
 *   3. users.quiet_hours_timezone     only when it isn't the 'UTC' default
 *   4. FALLBACK_TIMEZONE              documented fallback
 */

export const FALLBACK_TIMEZONE = "America/New_York";

/** True for a timezone name the runtime's Intl accepts (e.g. "Europe/London"). */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string") return false;
  const trimmed = tz.trim();
  if (!trimmed || trimmed.length > 64) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

export function resolveUserTimezone(input: {
  userTimezone?: string | null;
  streakTimezone?: string | null;
  quietHoursTimezone?: string | null;
}): string {
  if (isValidTimeZone(input.userTimezone)) return input.userTimezone.trim();
  if (isValidTimeZone(input.streakTimezone)) return input.streakTimezone.trim();
  if (input.quietHoursTimezone && input.quietHoursTimezone.trim() !== "UTC" && isValidTimeZone(input.quietHoursTimezone)) {
    return input.quietHoursTimezone.trim();
  }
  return FALLBACK_TIMEZONE;
}

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(now: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

/** Buyer-local calendar date, "YYYY-MM-DD". */
export function localDateKey(now: Date, timeZone: string): string {
  const p = localParts(now, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** ISO-8601 week of the buyer-local date, e.g. "2026-W42". */
export function isoWeekKey(now: Date, timeZone: string): string {
  const p = localParts(now, timeZone);
  const date = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dayNum = date.getUTCDay() || 7; // Mon=1 … Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // Thursday of this ISO week
  const isoYear = date.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Sunday 18:00–18:59 in the buyer's timezone: the weekly digest window. */
export function isWeeklyDigestWindow(now: Date, timeZone: string): boolean {
  const p = localParts(now, timeZone);
  return p.weekday === 0 && p.hour === 18;
}

/** 11:00–11:59 in the buyer's timezone: the order-anniversary window. */
export function isAnniversaryWindow(now: Date, timeZone: string): boolean {
  return localParts(now, timeZone).hour === 11;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * True when `now` is, in the buyer's timezone, exactly one calendar year after
 * the local date `paidAt` fell on. An order paid on Feb 29 has its
 * anniversary on Feb 28 of the following (non-leap) year.
 */
export function isOrderAnniversary(paidAt: Date, now: Date, timeZone: string): boolean {
  const paid = localParts(paidAt, timeZone);
  const today = localParts(now, timeZone);
  if (today.year !== paid.year + 1) return false;
  if (paid.month === 2 && paid.day === 29 && !isLeapYear(today.year)) {
    return today.month === 2 && today.day === 28;
  }
  return today.month === paid.month && today.day === paid.day;
}
