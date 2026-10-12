/**
 * "Share your store" — the store link every seller surface hands out. One
 * link everywhere: the seller's store website, brandthread.app/@<username>
 * (server-rendered by the API with a link preview card; see
 * artifacts/api-server/src/routes/storeSite.ts).
 */
import { BRANDTHREAD_ORIGIN, normalizeUsername } from '@/lib/shareProfile';

/** The seller's public store link, or null until they have a valid username. */
export function sellerStoreLink(username: string | null | undefined): string | null {
  const u = normalizeUsername(username);
  return u ? `${BRANDTHREAD_ORIGIN}/@${u}` : null;
}

/** "brandthread.app/@name" — the link without the scheme, for display. */
export function displayStoreLink(url: string): string {
  return url.replace(/^https?:\/\//, '');
}
