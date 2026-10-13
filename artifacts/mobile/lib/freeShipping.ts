/**
 * Sellers' free-shipping thresholds for the bag, fetched once per bag focus
 * (app/(buyer)/cart.tsx load) in one request for every seller in the bag:
 * GET /api/shipping-rates/free-shipping — public, read-only, no auth, so a
 * signed-out bag can call it too. Each FreeShippingStrip reads its seller's
 * value from this small store.
 *
 * Dev-web preview: seeded `preview-seller-*` ids have no server rows, so they
 * never hit the network; under `&demo=1` only they get the same $500
 * threshold preview checkout already charges against (lib/previewCheckout.ts).
 */
import { useSyncExternalStore } from 'react';
import { serviceRequest } from './serviceConfig';
import { isPreviewSellerId, PREVIEW_FREE_SHIPPING_CENTS } from './previewCheckout';
import { isPreviewDemoMode } from './devPreview';

const MAX_SELLERS = 20;
const thresholds = new Map<string, number | null>();
const listeners = new Set<() => void>();

function emit() { for (const listener of listeners) listener(); }

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function refreshFreeShippingThresholds(sellerIds: string[]): Promise<void> {
  const unique = [...new Set(sellerIds.filter(Boolean))];
  if (unique.length === 0) return;
  const real: string[] = [];
  for (const id of unique) {
    if (isPreviewSellerId(id)) thresholds.set(id, isPreviewDemoMode() ? PREVIEW_FREE_SHIPPING_CENTS : null);
    else real.push(id);
  }
  emit();
  if (real.length === 0) return;
  try {
    const res = await serviceRequest<{ thresholds?: Record<string, number | null> }>(
      `/api/shipping-rates/free-shipping?sellerIds=${real.slice(0, MAX_SELLERS).map(encodeURIComponent).join(',')}`,
      {},
      false,
    );
    for (const id of real) {
      const value = res?.thresholds?.[id];
      thresholds.set(id, typeof value === 'number' && value > 0 ? value : null);
    }
    emit();
  } catch {
    // No strip when the threshold can't be read; the bag works without it.
  }
}

/** This seller's threshold in cents, or null (unknown / none). */
export function useFreeShippingThreshold(sellerId: string): number | null {
  return useSyncExternalStore(subscribe, () => thresholds.get(sellerId) ?? null, () => null);
}

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
