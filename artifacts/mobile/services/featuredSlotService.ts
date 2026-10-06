/**
 * Helpers for the Featured-on-Discover purchase flow.
 * The return URL matches the server allowlist
 * isAllowedBrandthreadCallbackUrl(value, "featured_checkout").
 */
import type { FeaturedSlot } from '@/lib/api';

export function buildFeaturedReturnUrl(slotId: string, webOrigin?: string): string {
  const params = `id=${encodeURIComponent(slotId)}&paymentReturn=1`;
  return webOrigin ? `${webOrigin}/featured-slot?${params}` : `brandthread://featured-slot/?${params}`;
}

const LABELS: Record<FeaturedSlot['displayState'], string> = {
  awaiting_payment: 'Awaiting payment',
  in_review: 'In review',
  scheduled: 'Scheduled',
  live: 'Live',
  rejected: 'Rejected',
  ended: 'Ended',
  cancelled: 'Cancelled',
};

export function featuredStateLabel(state: FeaturedSlot['displayState']): string {
  return LABELS[state] ?? state;
}

/** Where a store-paid seller requests a refund (Brandthread cannot refund App Store / Play purchases). */
export function storeRefundUrl(os: string): string | null {
  if (os === 'ios') return 'https://reportaproblem.apple.com';
  if (os === 'android') return 'https://play.google.com/store/account/orderhistory';
  return null;
}

/** Store name for refund copy on a store-paid slot. */
export function storeName(os: string): string {
  return os === 'android' ? 'Google Play' : 'the App Store';
}

/** True when a cancelled / rejected slot's money sits with Apple or Google, not Stripe. */
export function needsStoreRefund(slot: Pick<FeaturedSlot, 'paidVia' | 'refundStatus'>): boolean {
  return slot.paidVia === 'store' || slot.refundStatus === 'store';
}
