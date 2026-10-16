/**
 * Admin bulk upload to @brandthread: pure helpers (no React, no network) so the
 * scheduling and validation rules are unit-testable.
 */

/** Most Threads one bulk upload publishes (the starter set is 10). */
export const MAX_BULK_ITEMS = 20;
/** Most photos in one slideshow Thread from the bulk screen. */
export const MAX_SLIDESHOW_PHOTOS = 10;
/** Slideshow crops offered on the bulk screen (photo editorial ratios). */
export const BULK_SLIDESHOW_ASPECTS = ['4:5', '3:4'] as const;
export type BulkSlideshowAspect = (typeof BULK_SLIDESHOW_ASPECTS)[number];

export type PublishPlan =
  | { kind: 'now' }
  | { kind: 'spread'; everyHours: number; startAt: number };

/** The server refuses schedules under 5 minutes or past 75 days out. */
const MIN_LEAD_MS = 10 * 60_000;
const MAX_LEAD_MS = 74 * 86_400_000;

/** Next whole hour at least 10 minutes away — a sensible first slot. */
export function defaultSpreadStart(now = Date.now()): number {
  const next = new Date(now + MIN_LEAD_MS);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next.getTime();
}

/**
 * ISO publish time for each item (null = publish now). "Spread" schedules one
 * Thread every `everyHours` from `startAt`, so the starter set lands evenly
 * instead of all at once. Throws if the last slot would be out of range.
 */
export function scheduleTimes(count: number, plan: PublishPlan, now = Date.now()): Array<string | null> {
  if (plan.kind === 'now') return Array.from({ length: count }, () => null);
  const every = Math.max(1, Math.floor(plan.everyHours)) * 3_600_000;
  const start = Math.max(plan.startAt, now + MIN_LEAD_MS);
  const times = Array.from({ length: count }, (_, i) => start + i * every);
  if (times.length > 0 && times[times.length - 1] - now > MAX_LEAD_MS) {
    throw new Error('That spread runs past 75 days. Pick a shorter gap.');
  }
  return times.map((t) => new Date(t).toISOString());
}

/** Normalises a credit handle as typed ("@Galoreyyz " -> "galoreyyz"); empty -> undefined. */
export function normalizeCreditHandle(raw: string | undefined): string | undefined {
  const handle = (raw ?? '').trim().replace(/^@+/, '').toLowerCase();
  return handle.length > 0 ? handle : undefined;
}

export function isValidCreditHandle(raw: string | undefined): boolean {
  const handle = normalizeCreditHandle(raw);
  return handle === undefined || /^[a-z0-9._]{1,30}$/.test(handle);
}

/** Moves one entry (drag-to-reorder). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}
