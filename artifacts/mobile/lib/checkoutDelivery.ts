/**
 * What the Order review says about delivery, Shop style: one line per store,
 * "Free shipping · Arrives Oct 16–20".
 *
 * The arrival range is real dates from business days (weekends skipped):
 *  - seller's processing time known (N business days): ships within N, then
 *    US ground takes STANDARD_TRANSIT_BUSINESS_DAYS → arrives N+2 … N+4;
 *  - unknown: the store-wide 3–5 business days (lib/checkoutPayment.ts
 *    GENERIC_DELIVERY_WINDOW);
 *  - pre-order: "Ships after production" (no promise of a date).
 */
import { formatCents } from '@/lib/money';

export const STANDARD_TRANSIT_BUSINESS_DAYS = [2, 4] as const;
export const GENERIC_ARRIVAL_BUSINESS_DAYS = [3, 5] as const;

/** `date` moved forward by `days` business days (Saturday and Sunday skipped). */
export function addBusinessDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  let left = Math.max(0, Math.round(days));
  while (left > 0) {
    next.setDate(next.getDate() + 1);
    const day = next.getDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return next;
}

/** Business-day window from today until it arrives, or null for a pre-order. */
export function arrivalBusinessDays(input: { processingDays?: number | null; isPreOrder?: boolean }): [number, number] | null {
  if (input.isPreOrder) return null;
  const days = input.processingDays;
  if (typeof days !== 'number' || !Number.isFinite(days) || days < 0) return [...GENERIC_ARRIVAL_BUSINESS_DAYS];
  const ship = Math.max(1, Math.round(days));
  return [ship + STANDARD_TRANSIT_BUSINESS_DAYS[0], ship + STANDARD_TRANSIT_BUSINESS_DAYS[1]];
}

const MONTH = (date: Date) => date.toLocaleDateString('en-US', { month: 'short' });

/** "Oct 16–20", or "Oct 30 – Nov 3" across months, or "Oct 16" for one day. */
export function formatDateRange(from: Date, to: Date): string {
  if (from.getTime() === to.getTime()) return `${MONTH(from)} ${from.getDate()}`;
  if (from.getMonth() === to.getMonth()) return `${MONTH(from)} ${from.getDate()}–${to.getDate()}`;
  return `${MONTH(from)} ${from.getDate()} – ${MONTH(to)} ${to.getDate()}`;
}

/** "Arrives Oct 16–20" or "Ships after production". */
export function arrivalLabel(input: { processingDays?: number | null; isPreOrder?: boolean }, today: Date = new Date()): string {
  const window = arrivalBusinessDays(input);
  if (!window) return 'Ships after production';
  return `Arrives ${formatDateRange(addBusinessDays(today, window[0]), addBusinessDays(today, window[1]))}`;
}

/** "Free shipping" or "$8.00 shipping". */
export function shippingPriceLabel(cents: number): string {
  return cents <= 0 ? 'Free shipping' : `${formatCents(cents)} shipping`;
}

/** The one line under a store's name: "Free shipping · Arrives Oct 16–20". */
export function shippingLine(input: {
  priceCents: number;
  processingDays?: number | null;
  isPreOrder?: boolean;
}, today: Date = new Date()): string {
  return `${shippingPriceLabel(input.priceCents)} · ${arrivalLabel(input, today)}`;
}
