/**
 * Pure time-bucketing helpers for the seller analytics endpoints. Kept free of
 * any DB/Express imports so they can be unit tested without a live database.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const TEN_MIN_MS = 10 * 60 * 1000;

/**
 * Parses the caller's timezone offset (minutes east of UTC, i.e. -Date#getTimezoneOffset())
 * so day/hour boundaries land on the seller's local calendar day and clock hour instead of
 * the server's. Falls back to UTC when missing/invalid.
 */
export function parseTzOffsetMinutes(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-840, Math.min(840, Math.round(n)));
}

/** Floors `date` to the nearest `stepMs` boundary, measured in the given local timezone. */
export function floorToLocalStep(date: Date, stepMs: number, tzOffsetMinutes: number): Date {
  const localMs = date.getTime() + tzOffsetMinutes * 60_000;
  const flooredLocalMs = Math.floor(localMs / stepMs) * stepMs;
  return new Date(flooredLocalMs - tzOffsetMinutes * 60_000);
}

/**
 * The immediately preceding period of the same length as [start, end) — e.g.
 * yesterday for "today", the prior week for "this week" — used for a real
 * period-over-period comparison instead of a fabricated one.
 */
export function previousPeriod(start: Date, end: Date): { start: Date; end: Date } {
  const periodMs = end.getTime() - start.getTime();
  return { start: new Date(start.getTime() - periodMs), end: start };
}

/**
 * Floors `date` to the first of its local calendar month (at local midnight),
 * in the given local timezone. Unlike `floorToLocalStep`, month length is
 * variable, so this works in local calendar fields rather than a fixed ms
 * step.
 */
export function floorToLocalMonth(date: Date, tzOffsetMinutes: number): Date {
  const local = new Date(date.getTime() + tzOffsetMinutes * 60_000);
  const flooredLocalMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  return new Date(flooredLocalMs - tzOffsetMinutes * 60_000);
}

/**
 * Adds `months` calendar months to `date` in the given local timezone (may be
 * negative). Used to build month-bucketed windows (Year/All ranges) where a
 * fixed ms step would drift across months of different lengths.
 */
export function addLocalMonths(date: Date, months: number, tzOffsetMinutes: number): Date {
  const local = new Date(date.getTime() + tzOffsetMinutes * 60_000);
  const shiftedLocalMs = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth() + months,
    local.getUTCDate(),
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
  );
  return new Date(shiftedLocalMs - tzOffsetMinutes * 60_000);
}
