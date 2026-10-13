/**
 * Per-brand shipping in the bag (polish item 111).
 *
 * Pure helpers only: the rates themselves come from the same seller-rate
 * source checkout uses (cartService.fetchShippingRateDetails →
 * GET /api/shipping-rates/calculate), fetched by hooks/useBagShippingRates.
 *
 * Rule: never show a made-up number. A brand whose rate we could not load
 * shows no shipping line, and the bag total only includes shipping when
 * every brand's rate is known, so the per-brand lines always add up to the
 * "Shipping & fees" row.
 */
import { formatCents } from '@/lib/money';

/** sellerId → shipping cents for that seller's current subtotal (undefined = unknown). */
export type BagShippingRates = Record<string, number | undefined>;

/** Cache key: a rate depends on the seller and their subtotal (free-above thresholds). */
export function shippingRateKey(sellerId: string, subtotalCents: number): string {
  return `${sellerId}:${subtotalCents}`;
}

function isKnownCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** "Shipping $5.95", "Free shipping", or null when the rate is unknown. */
export function groupShippingLabel(cents: number | undefined): string | null {
  if (!isKnownCents(cents)) return null;
  return cents === 0 ? 'Free shipping' : `Shipping ${formatCents(cents)}`;
}

/**
 * Sum of every group's shipping, or null when any group's rate is unknown
 * (the bag then keeps its existing summary rather than a partial total).
 */
export function bagShippingTotal(
  groups: readonly { sellerId: string }[],
  rates: BagShippingRates,
): number | null {
  if (groups.length === 0) return null;
  let total = 0;
  for (const group of groups) {
    const cents = rates[group.sellerId];
    if (!isKnownCents(cents)) return null;
    total += cents;
  }
  return total;
}
