/**
 * Pure x-axis label formatting for the seller dashboard's Sales activity
 * chart. Kept free of any React Native imports so it can be unit tested
 * directly (and reused) without mounting the dashboard component.
 *
 * Deliberately avoids toLocaleDateString/toLocaleTimeString: RN Hermes' Intl
 * support for the `weekday` option is unreliable and was rendering every
 * "This week" bucket as the same truncated string ("WE WE WE ..."). Date's
 * plain getters (getDay/getHours/getMinutes) always reflect the device's
 * local time zone, so this stays correct without depending on ICU/Intl.
 */

export type SellerHomeTimeRange = 'live' | 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'all';

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const HAS_EXPLICIT_ZONE = /(?:[Zz]|[+-]\d{2}:?\d{2})$/;

/**
 * Parses a bucket timestamp from the analytics API into a `Date` that
 * represents the exact same instant the server meant, regardless of engine.
 *
 * The server always computes bucket boundaries as real UTC instants (see
 * `floorToLocalStep` in the API), but depending on the DB driver/serializer
 * the value can arrive as a strict ISO string with a `Z`/offset, or as a
 * Postgres-style "YYYY-MM-DD HH:mm:ss" string with a space separator and no
 * zone at all. `new Date(...)` on that second shape is ambiguous: it is
 * engine-dependent whether it's parsed as UTC or as the device's local time,
 * and Hermes and V8 (used in Metro's dev tooling / web preview) do not agree.
 * That mismatch is exactly what caused "This week" to bucket every day onto
 * the same one or two weekdays for some devices/timezones. Normalizing to an
 * explicit UTC ISO string before parsing removes the ambiguity so day/hour
 * derivation below is always correct, and always in the *device's* local
 * time zone (via the plain Date getters), not the server's.
 */
export function parseBucketTimestamp(value: string): Date {
  const trimmed = value.trim();
  const isoLike = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const normalized = HAS_EXPLICIT_ZONE.test(isoLike) ? isoLike : `${isoLike}Z`;
  return new Date(normalized);
}

export function formatClockLabel(date: Date, includeMinutes: boolean): string {
  const hour24 = date.getHours();
  const period = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  if (!includeMinutes) return `${hour12} ${period}`;
  return `${hour12}:${String(date.getMinutes()).padStart(2, '0')} ${period}`;
}

export function bucketLabel(value: string, range: SellerHomeTimeRange): string {
  const date = parseBucketTimestamp(value);
  if (range === 'week') {
    return WEEKDAY_LABELS[date.getDay()];
  }
  if (range === 'month') {
    return String(date.getDate());
  }
  if (range === 'year' || range === 'all') {
    return MONTH_LABELS[date.getMonth()];
  }
  return formatClockLabel(date, range === 'live');
}

/**
 * Picks a small, evenly-spaced subset of bucket indices to actually show
 * text for on the chart's x-axis, so a dense range (e.g. 30 daily buckets
 * for "Month", or 24 hourly buckets for "Today") reads as a handful of
 * clean, non-overlapping labels instead of every single bucket's label
 * crammed edge-to-edge (Shopify's own Sales Report/Analytics charts do the
 * same — see the Mobbin references in the PR description).
 *
 * `count` is left untouched by the caller (every bucket still lays out and
 * is scrubbable) — only which indices get a *visible* label text changes.
 *
 * @param anchorEnds  true (default) spreads `want` marks from index 0 to
 *   index `count - 1` inclusive (used for Month/Year/All, where the first
 *   and last bucket are meaningful endpoints). false spreads `want` marks
 *   at even quarter-points of the range instead (used for Today, where
 *   Shopify's own chart shows 12am/6am/12pm/6pm — quarters of the day, not
 *   "first bucket, last bucket").
 */
export function selectEvenlySpacedIndices(count: number, want: number, anchorEnds = true): number[] {
  if (count <= 0 || want <= 0) return [];
  if (count <= want) return Array.from({ length: count }, (_, i) => i);
  const indices = new Set<number>();
  for (let i = 0; i < want; i++) {
    const idx = anchorEnds
      ? Math.round((i * (count - 1)) / (want - 1))
      : Math.min(count - 1, Math.round((i * count) / want));
    indices.add(idx);
  }
  return Array.from(indices).sort((a, b) => a - b);
}
