import {
  clearBadge,
  getBadgeCount,
  getLastViewedAt,
  setBadgeCount,
} from './orderBadgeStore';

export const SELLER_ORDERS_ROUTE = '/(tabs)/orders' as const;

/**
 * The single count consumed by both seller home and the Orders tab.
 * Keeping the user lookup here prevents either surface from accidentally
 * falling back to an account-agnostic badge value.
 */
export function getSellerOrderBadgeCount(
  userId: string | null | undefined,
): number {
  return userId ? getBadgeCount(userId) : 0;
}

/**
 * Open Orders from a seller badge touch-point.
 * Clearing happens synchronously before navigation so the tab cannot briefly
 * show a stale badge after the home row has been opened.
 */
export function openSellerOrders(
  userId: string | null | undefined,
  navigate: (route: typeof SELLER_ORDERS_ROUTE) => void,
): void {
  if (userId) clearBadge(userId);
  navigate(SELLER_ORDERS_ROUTE);
}
/**
 * Recount the seller's new-order badge from the server list — the same rule
 * the tab bar's own 30s poll uses (pending orders created after the seller
 * last opened Orders). Called when the realtime socket reports a new order,
 * so the badge moves immediately; the tab bar's poll keeps reconciling.
 */
export async function refreshSellerOrderBadge(
  userId: string,
  listOrders: () => Promise<unknown>,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const rows = await listOrders();
    const lastViewed = getLastViewedAt(userId);
    const count = Array.isArray(rows)
      ? (rows as Array<{ status?: string; createdAt?: string }>).filter(
          (r) => r.status === 'pending' && new Date(r.createdAt ?? 0).getTime() > lastViewed,
        ).length
      : 0;
    setBadgeCount(userId, count, startedAt);
  } catch {
    // Badges are best-effort; the tab bar's poll reconciles.
  }
}
