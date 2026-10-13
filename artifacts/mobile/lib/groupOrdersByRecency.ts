/**
 * Buckets a newest-first list into Shopify-style recency sections:
 * "Today", "This week" (since Sunday, excluding today) and "Earlier".
 * Day boundaries follow the seller's local time zone (the device zone by
 * default; pass `timeZone` to pin one). Empty buckets are omitted and the
 * input order is preserved inside each bucket.
 */
export type RecencyTitle = 'Today' | 'This week' | 'Earlier';

const DAY_MS = 86_400_000;
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Whole-day ordinal and weekday (0 = Sunday) of `date` in `timeZone`. */
function localDay(date: Date, timeZone?: string): { ordinal: number; weekday: number } {
  if (!timeZone) {
    return {
      ordinal: Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS),
      weekday: date.getDay(),
    };
  }
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
    });
    formatters.set(timeZone, fmt);
  }
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    ordinal: Math.floor(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / DAY_MS),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

export function groupOrdersByRecency<T extends { createdAt: string }>(
  items: readonly T[],
  now: Date = new Date(),
  timeZone?: string,
): { title: RecencyTitle; data: T[] }[] {
  const today = localDay(now, timeZone);
  const weekStart = today.ordinal - today.weekday;
  const todays: T[] = [];
  const week: T[] = [];
  const earlier: T[] = [];
  for (const item of items) {
    const date = new Date(item.createdAt);
    if (Number.isNaN(date.getTime())) { earlier.push(item); continue; }
    const { ordinal } = localDay(date, timeZone);
    if (ordinal >= today.ordinal) todays.push(item);
    else if (ordinal >= weekStart) week.push(item);
    else earlier.push(item);
  }
  const sections: { title: RecencyTitle; data: T[] }[] = [];
  if (todays.length) sections.push({ title: 'Today', data: todays });
  if (week.length) sections.push({ title: 'This week', data: week });
  if (earlier.length) sections.push({ title: 'Earlier', data: earlier });
  return sections;
}
