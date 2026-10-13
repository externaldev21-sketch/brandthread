/**
 * Item 124: a real "Expected by" date for refunds instead of the fixed
 * "5–10 business days" copy. Card refunds land within 10 business days of
 * being issued, so the date is the refund (or cancellation) time plus 10
 * business days, skipping Saturdays and Sundays. Formatted with the device
 * locale. Pure module: safe to unit test.
 */

export const REFUND_BUSINESS_DAYS = 10;

/** `from` plus `days` business days (Mon–Fri), keeping the time of day. */
export function addBusinessDays(from: Date, days: number): Date {
  const out = new Date(from.getTime());
  let left = Math.max(0, Math.floor(days));
  while (left > 0) {
    out.setDate(out.getDate() + 1);
    const day = out.getDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return out;
}

/** The latest day a refund issued at `issuedAt` should appear; null for a missing or bad date. */
export function refundExpectedDate(issuedAt: string | Date | null | undefined): Date | null {
  if (!issuedAt) return null;
  const start = issuedAt instanceof Date ? issuedAt : new Date(issuedAt);
  if (!Number.isFinite(start.getTime())) return null;
  return addBusinessDays(start, REFUND_BUSINESS_DAYS);
}

/** "Oct 24" in the device locale (the year only when it differs from `now`'s). */
export function formatRefundDate(date: Date, now: Date = new Date(), locale?: string): string {
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

/** "Expected by Oct 24", or null when the date is unknown. */
export function refundExpectedLabel(issuedAt: string | Date | null | undefined, now: Date = new Date(), locale?: string): string | null {
  const date = refundExpectedDate(issuedAt);
  return date ? `Expected by ${formatRefundDate(date, now, locale)}` : null;
}
