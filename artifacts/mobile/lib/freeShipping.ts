/**
 * Free-shipping status for one seller's section of the bag.
 *
 * Pure: takes the seller's real free-shipping threshold (from their shipping
 * rate, or null when they have none) and the subtotal of their items in the
 * bag. No threshold means no message; the bag never invents one.
 */
import { formatCents } from '@/lib/money';

export type FreeShippingStatus =
  | { kind: 'none' }
  | { kind: 'free' }
  | { kind: 'remaining'; remainingCents: number };

export function freeShippingStatus(
  subtotalCents: number,
  thresholdCents: number | null | undefined,
): FreeShippingStatus {
  if (typeof thresholdCents !== 'number' || !Number.isFinite(thresholdCents) || thresholdCents < 0) {
    return { kind: 'none' };
  }
  const subtotal = Number.isFinite(subtotalCents) ? Math.max(0, Math.round(subtotalCents)) : 0;
  const threshold = Math.round(thresholdCents);
  if (subtotal >= threshold) return { kind: 'free' };
  return { kind: 'remaining', remainingCents: threshold - subtotal };
}

/** "$24" for whole dollars, "$23.50" otherwise. */
function compactDollars(cents: number): string {
  const full = formatCents(cents);
  return cents % 100 === 0 ? full.replace(/\.00$/, '') : full;
}

/** The seller header's line: "Free shipping", "$24 away from free shipping", or null. */
export function freeShippingLabel(
  subtotalCents: number,
  thresholdCents: number | null | undefined,
): string | null {
  const status = freeShippingStatus(subtotalCents, thresholdCents);
  if (status.kind === 'free') return 'Free shipping';
  if (status.kind === 'remaining') return `${compactDollars(status.remainingCents)} away from free shipping`;
  return null;
}
