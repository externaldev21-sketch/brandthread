/**
 * Item 129: seller-set buyer cancellation window.
 * Server: users.buyer_cancel_window_hours (migration 272), GET/PUT
 * /api/seller/cancel-window, and `buyerCancelDeadline` on the buyer order.
 * Pure module: safe to unit test.
 */

/** null = "Until shipped" (the platform default, up to day 21). */
export type CancelWindowHours = 1 | 12 | 24 | 72 | null;

export const CANCEL_WINDOW_OPTIONS: { hours: CancelWindowHours; label: string }[] = [
  { hours: 1, label: '1 hour' },
  { hours: 12, label: '12 hours' },
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
  { hours: null, label: 'Until shipped' },
];

export function cancelWindowLabel(hours: number | null | undefined): string {
  return CANCEL_WINDOW_OPTIONS.find(option => option.hours === (hours ?? null))?.label ?? 'Until shipped';
}

/**
 * "You can cancel until 3:40 PM" (today), "… until tomorrow, 9:00 AM", or
 * "… until Oct 24, 3:40 PM". null when there is no deadline or it has passed.
 */
export function cancelDeadlineText(deadline: string | null | undefined, now: Date = new Date(), locale?: string): string | null {
  if (!deadline) return null;
  const end = new Date(deadline);
  if (!Number.isFinite(end.getTime()) || end.getTime() < now.getTime()) return null;
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(end);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOf(end) - startOf(now)) / 86_400_000);
  if (dayDiff === 0) return `You can cancel until ${time}`;
  if (dayDiff === 1) return `You can cancel until tomorrow, ${time}`;
  const date = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(end.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(end);
  return `You can cancel until ${date}, ${time}`;
}
