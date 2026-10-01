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
