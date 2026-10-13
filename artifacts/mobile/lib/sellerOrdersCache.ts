/**
 * Offline copy of the seller's Orders list. The last successful
 * `api.orders.list()` response is kept on the device (per account, through
 * lib/tabDataCache), so Orders opens with real orders on a cold start with
 * no connection, then refreshes as soon as the network answers.
 */
import { hydrateTabData, setCachedTabData } from '@/lib/tabDataCache';

const KEY = 'seller-orders:list:v1';
/** Newest first, as the API returns them; enough for any day's packing. */
export const SELLER_ORDERS_CACHE_LIMIT = 200;

export function trimSellerOrdersForCache<T>(rows: readonly T[]): T[] {
  return rows.slice(0, SELLER_ORDERS_CACHE_LIMIT);
}

export function saveSellerOrdersCache(rows: unknown): void {
  if (!Array.isArray(rows)) return;
  setCachedTabData(KEY, trimSellerOrdersForCache(rows));
}

export async function readSellerOrdersCache<T = unknown>(): Promise<T[] | undefined> {
  const cached = await hydrateTabData<unknown>(KEY);
  return Array.isArray(cached) && cached.length > 0 ? (cached as T[]) : undefined;
}
