/**
 * Item 128: "Search all orders" (Amazon's Your Orders pattern). Client-side,
 * because the buyer's order list is loaded in full (GET /api/buyer/orders
 * has no paging). Matches product names, the seller/brand name and the
 * order number, case- and accent-insensitive; every word must match.
 * Pure module: safe to unit test.
 */
export interface SearchableOrder {
  orderNumber?: string | null;
  sellerName?: string | null;
  lineItems?: { productName?: string | null; variant?: string | null }[];
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function orderSearchText(order: SearchableOrder): string {
  const parts = [
    order.orderNumber ?? '',
    order.sellerName ?? '',
    ...(order.lineItems ?? []).map(item => item.productName ?? ''),
  ];
  return fold(parts.join(' \u0000 '));
}

export function matchesOrderSearch(order: SearchableOrder, query: string): boolean {
  const words = fold(query).replace(/#/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = orderSearchText(order);
  return words.every(word => haystack.includes(word));
}

export function searchOrders<T extends SearchableOrder>(orders: T[], query: string): T[] {
  if (!query.trim()) return orders;
  return orders.filter(order => matchesOrderSearch(order, query));
}
