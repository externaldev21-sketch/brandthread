import {
  clearBadge,
  getBadgeCount,
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