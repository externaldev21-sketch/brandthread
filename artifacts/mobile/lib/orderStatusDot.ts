/**
 * Seller order status as one dot + one word (orders list + order detail).
 *
 * Replaces the payment/fulfillment pill pair and the coloured StatusBadges
 * with a single state a seller reads at a glance (Shopify iOS pattern):
 *
 *   Pending   gray dot     payment not confirmed yet (unpaid checkout)
 *   Paid      white dot    paid, not shipped yet (new / processing / ready to ship)
 *   Shipped   silver dot   handed to the carrier
 *   Delivered silver ring  done
 *   Cancelled gray ring    closed, no money moved to the seller
 *   Refunded  gray ring    closed, money returned
 *   Disputed  white ring   needs the seller's attention, but no colour
 *
 * Filled dots are orders still moving; rings are orders that have stopped.
 * Tones are theme token names (gray = border, white = text, silver = muted), never literals.
 */
import type { OrderStatus, PaymentStatus } from '@/services/orderTypes';

export type OrderStatusDotLabel =
  | 'Pending' | 'Paid' | 'Shipped' | 'Delivered' | 'Cancelled' | 'Refunded' | 'Disputed';

/** The theme token the dot is painted with: border reads gray, text reads white, muted reads silver. */
export type OrderStatusDotTone = 'border' | 'text' | 'muted';

export interface OrderStatusDotSpec {
  label: OrderStatusDotLabel;
  tone: OrderStatusDotTone;
  /** Filled dot while the order is moving; a ring once it has stopped. */
  filled: boolean;
}

const UNPAID: ReadonlySet<string> = new Set(['pending', 'authorized', 'failed']);

export function orderStatusDot(order: { status: OrderStatus; paymentStatus: PaymentStatus | string }): OrderStatusDotSpec {
  switch (order.status) {
    case 'shipped':   return { label: 'Shipped', tone: 'muted', filled: true };
    case 'delivered': return { label: 'Delivered', tone: 'muted', filled: false };
    case 'cancelled': return { label: 'Cancelled', tone: 'border', filled: false };
    case 'refunded':  return { label: 'Refunded', tone: 'border', filled: false };
    case 'disputed':  return { label: 'Disputed', tone: 'text', filled: false };
    default:
      // new / processing / ready_to_ship: the money is what's left to say.
      return UNPAID.has(order.paymentStatus)
        ? { label: 'Pending', tone: 'border', filled: true }
        : { label: 'Paid', tone: 'text', filled: true };
  }
}

export function statusDotColor(
  tone: OrderStatusDotTone,
  theme: { text: string; muted: string; border: string },
): string {
  return theme[tone];
}
