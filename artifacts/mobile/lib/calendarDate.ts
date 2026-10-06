/**
 * Calendar dates ("ships Dec 1") are stored date-only: either a bare
 * `YYYY-MM-DD` or a timestamp at midnight UTC. `new Date(value)` plus
 * `toLocaleDateString()` renders those in the viewer's zone, which shows the
 * previous day (and on the 1st, the previous month) anywhere west of UTC.
 * Format them in UTC so everybody sees the date the seller picked.
 * Real timestamps (any other time of day) keep the viewer's zone.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MIDNIGHT_UTC = /T00:00(:00(\.0+)?)?(Z|\+00:00)$/;

export function isCalendarDate(value: string): boolean {
  return DATE_ONLY.test(value) || MIDNIGHT_UTC.test(value);
}

export function formatCalendarDate(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
  locale = 'en-US',
): string {
  if (value == null || value === '') return '';
  const raw = value instanceof Date ? value.toISOString() : value;
  const date = new Date(DATE_ONLY.test(raw) ? `${raw}T00:00:00Z` : raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale, isCalendarDate(raw) ? { ...options, timeZone: 'UTC' } : options);
}

/** `YYYY-MM-DD` for a date input: the stored calendar day, or the viewer's local day for real timestamps. */
export function toDateInputValue(value: string | null | undefined): string {
  if (!value) return '';
  if (DATE_ONLY.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const utc = isCalendarDate(value);
  const y = utc ? date.getUTCFullYear() : date.getFullYear();
  const m = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
  const d = utc ? date.getUTCDate() : date.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Validates a typed `YYYY-MM-DD` that must be today or later (in the viewer's
 * zone). Returns an error message, or null when the value is empty or valid.
 */
export function futureDateInputError(value: string, now: Date = new Date()): string | null {
  const v = value.trim();
  if (!v) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!match) return 'Use the format YYYY-MM-DD.';
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return 'That date doesn’t exist.';
  }
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (v < today) return 'Pick today or a later date.';
  return null;
}
