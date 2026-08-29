import type { BuyerOrderView } from '@/services/orderTypes';

/**
 * Prevent account-bound rows from rendering while Clerk is switching active
 * sessions and the new buyer's request is still pending.
 */
export function visibleOrdersForBuyer(
  orders: BuyerOrderView[],
  ordersOwnerId: string | null | undefined,
  activeUserId: string | null | undefined,
): BuyerOrderView[] {
  return ordersOwnerId === activeUserId ? orders : [];
}

export function visibleOrderForBuyer(
  order: BuyerOrderView | null,
  orderOwnerId: string | null | undefined,
  activeUserId: string | null | undefined,
): BuyerOrderView | null {
  return orderOwnerId === activeUserId ? order : null;
}
