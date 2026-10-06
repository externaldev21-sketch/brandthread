/**
 * Buyer "My orders" card: the status pill (top-right) and the bold delivery
 * headline under it must not say the same thing twice ("DELIVERED" pill next
 * to "Delivered Oct 3"). When the headline already names the order's state —
 * delivered, refunded, or auto-refunded for a late delivery — the headline is
 * the richer of the two (it carries the date / reason), so the pill is
 * dropped. Every other state (shipped + "Arriving …", processing, pre-order)
 * keeps both, since they say different things.
 */
export function statusBadgeRepeatsHeadline(order: {
  status: string;
  hasHeadline: boolean;
  autoRefunded: boolean;
}): boolean {
  if (!order.hasHeadline) return false;
  return order.autoRefunded || order.status === 'delivered' || order.status === 'refunded';
}
