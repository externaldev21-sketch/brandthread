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
