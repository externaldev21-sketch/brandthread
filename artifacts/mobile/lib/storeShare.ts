/**
 * "Share your store" — the store link every seller surface hands out. One
 * link everywhere: the canonical
 * public address the dashboard title row already copies
 * (lib/shareProfile — brandthread.app/u/<username>), which the API serves as
 * a real landing page with link previews.
 */
import { buildCanonicalProfileUrl } from '@/lib/shareProfile';

/** The seller's public store link, or null until they have a valid username. */
export function sellerStoreLink(username: string | null | undefined): string | null {
  return buildCanonicalProfileUrl(username);
}

/** "brandthread.app/u/name" — the link without the scheme, for display. */
export function displayStoreLink(url: string): string {
  return url.replace(/^https?:\/\//, '');
}
