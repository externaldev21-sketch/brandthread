/**
 * Date handling for a discount code's active window (QA-0076).
 *
 * The seller picks whole calendar days in their own timezone. A "day key"
 * ('YYYY-MM-DD') is always interpreted as a LOCAL day — never via
 * `new Date('YYYY-MM-DD')`, which parses as UTC midnight and made a code
 * "ending Nov 30" stop working on the afternoon of Nov 29 in the Americas.
 *
 *   startsAt  = start of the local start day (00:00:00.000 local)
 *   expiresAt = end of the local end day     (23:59:59.999 local)
 *
 * The server treats a code as expired once expiresAt <= now, so the end day
 * is inclusive.
 */

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day of `d` as 'YYYY-MM-DD'. */
export function toDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Strictly parses 'YYYY-MM-DD' to LOCAL midnight; null for anything else (incl. 2026-02-30). */
export function parseDayKey(key: string): Date | null {
  const m = DAY_KEY_RE.exec(key.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(y, mo, day, 0, 0, 0, 0);
  if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
  return d;
}

/** The local day a stored ISO timestamp falls on ('' when absent/invalid). */
export function isoToDayKey(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : toDayKey(d);
}

/** ISO instant for 00:00:00.000 local on `key`'s day. */
export function startOfLocalDayIso(key: string): string | null {
  const d = parseDayKey(key);
  return d ? d.toISOString() : null;
}

/** ISO instant for 23:59:59.999 local on `key`'s day. */
export function endOfLocalDayIso(key: string): string | null {
  const d = parseDayKey(key);
  if (!d) return null;
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

/** 'Dec 1, 2026' style label for a day key ('' when invalid). */
export function formatDayKey(key: string): string {
  const d = parseDayKey(key);
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

export type DiscountDateResult =
  | { ok: true; startsAt: string | null; expiresAt: string | null }
  | { ok: false; title: string; message: string };

/**
 * Validates the form's dates and converts them to the API payload.
 * `startKey` '' = starts immediately; `hasEnd` false = no end date.
 */
export function resolveDiscountDates(
  input: { startKey: string; endKey: string; hasEnd: boolean },
  now: Date = new Date(),
): DiscountDateResult {
  const startsAt = input.startKey ? startOfLocalDayIso(input.startKey) : null;
  if (input.startKey && !startsAt) {
    return { ok: false, title: 'Invalid start date', message: 'Pick a start date from the calendar.' };
  }
  if (!input.hasEnd) return { ok: true, startsAt, expiresAt: null };

  if (!input.endKey) {
    return { ok: false, title: 'Pick an end date', message: 'Choose when this code stops working, or turn off the end date.' };
  }
  const expiresAt = endOfLocalDayIso(input.endKey);
  if (!expiresAt) {
    return { ok: false, title: 'Invalid end date', message: 'Pick an end date from the calendar.' };
  }
  const from = startsAt ? new Date(startsAt).getTime() : now.getTime();
  if (new Date(expiresAt).getTime() <= from) {
    return startsAt
      ? { ok: false, title: 'End date is before start', message: 'The end date must be on or after the start date.' }
      : { ok: false, title: 'End date has passed', message: 'Choose an end date of today or later.' };
  }
  return { ok: true, startsAt, expiresAt };
}
