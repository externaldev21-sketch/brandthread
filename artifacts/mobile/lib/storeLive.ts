/**
 * "Your store is live" — the one-time moment after a seller publishes their
 * first product (app/store-live.tsx). Pure decision + storage key; the
 * AsyncStorage read/write lives with the caller.
 */

export const STORE_LIVE_SEEN_PREFIX = 'bt:store-live-seen:v1:';

export function storeLiveSeenKey(userId: string): string {
  return `${STORE_LIVE_SEEN_PREFIX}${userId}`;
}

export interface OwnProductRow {
  id: string;
  status?: string | null;
}

/**
 * True only for the first product to go live: exactly one active product,
 * it's the one just published, and the moment hasn't been shown on this
 * device for this seller. Sellers who were already live before this shipped
 * have more than one active product, so they never see it.
 */
export function isFirstStoreLive(rows: OwnProductRow[], publishedId: string, alreadySeen: boolean): boolean {
  if (alreadySeen) return false;
  const active = rows.filter((r) => r.status === 'active');
  return active.length === 1 && active[0]!.id === publishedId;
}
