/**
 * Shared DB order-status → UI status/payment-status adapter.
 *
 * This is the single source of truth for mapping the raw `status` column on
 * an order row to the UI `OrderStatus` and `PaymentStatus` enums. Order list
 * and order detail screens must both use this so a delivered/refunded/
 * disputed order never shows a "NEW" badge or a false "Paid" pill.
 */

import type { OrderStatus } from '@/services/orderTypes';

export const DB_STATUS_MAP: Record<string, OrderStatus> = {
  pending:        'new',
  processing:     'processing',
  fulfilled:      'ready_to_ship',
  shipped:        'shipped',
  delivered:      'delivered',
  cancelled:      'cancelled',
  refunded:       'refunded',
  refund_pending: 'cancelled', // order was cancelled; refund may need manual resolution
  disputed:       'disputed',
};

export function dbStatusToOrderStatus(dbStatus: string): OrderStatus {
  return DB_STATUS_MAP[dbStatus] ?? 'cancelled';
}

export type DbPaymentStatus = 'pending' | 'authorized' | 'paid' | 'partially_refunded' | 'refunded' | 'voided' | 'failed';

export const DB_PAYMENT_STATUS_MAP: Record<string, DbPaymentStatus> = {
  pending:        'pending',
  processing:     'paid',
  fulfilled:      'paid',
  shipped:        'paid',
  delivered:      'paid',
  cancelled:      'voided',
  refunded:       'refunded',
  refund_pending: 'authorized', // payment received but refund not yet confirmed
  disputed:       'partially_refunded',
};

/**
 * `paidAt` is the order's own payment timestamp (set by the checkout webhook
 * once Stripe confirms payment). A buyer's paid checkout order is stored as
 * status "pending" — meaning new / not yet processed, not "unpaid" — so when
 * the row says it was paid, the seller must see Paid, not a Pending payment
 * pill or the order under the Unpaid filter. Rows without `paidAt` (older API
 * responses, seller-created orders) keep the status-only mapping.
 */
export function dbStatusToPaymentStatus(dbStatus: string, paidAt?: string | Date | null): DbPaymentStatus {
  if (dbStatus === 'pending' && paidAt) return 'paid';
  return DB_PAYMENT_STATUS_MAP[dbStatus] ?? 'pending';
}

export type OrderStatusBadgeVariant = 'info' | 'purple' | 'warning' | 'success' | 'neutral' | 'error';

/**
 * The order status badge's label/color mapping — mirrors
 * app/buyer-order-detail.tsx's own (module-local) statusBadgeLabel/
 * statusBadgeVariant exactly, so the chat order card (item 71) never shows
 * a status badge that disagrees with the order detail screen's own badge
 * for the identical order. Kept here, not imported from that screen, so a
 * change to one doesn't silently change the other — if this ever drifts,
 * fix both.
 */
export function orderStatusBadgeLabel(status: OrderStatus): string {
  switch (status) {
    case 'new':           return 'NEW';
    case 'processing':    return 'PROCESSING';
    case 'ready_to_ship': return 'READY TO SHIP';
    case 'shipped':       return 'SHIPPED';
    case 'delivered':     return 'DELIVERED';
    case 'cancelled':     return 'CANCELLED';
    case 'refunded':      return 'REFUNDED';
    case 'disputed':      return 'DISPUTED';
    default:              return (status as string).toUpperCase();
  }
}

export function orderStatusBadgeVariant(status: OrderStatus): OrderStatusBadgeVariant {
  switch (status) {
    case 'new':           return 'info';
    case 'processing':    return 'purple';
    case 'ready_to_ship': return 'warning';
    case 'shipped':       return 'warning';
    case 'delivered':     return 'success';
    case 'cancelled':     return 'neutral';
    case 'refunded':      return 'error';
    case 'disputed':      return 'error';
    default:              return 'neutral';
  }
}

/**
 * Builds a real carrier tracking URL from the carrier name + tracking
 * number — mirrors app/buyer-order-detail.tsx's own (module-local)
 * carrierTrackingUrl exactly, for the same reason as the badge helpers
 * above. Falls back to a tracking-number web search when the carrier isn't
 * recognized.
 */
export function carrierTrackingUrl(carrier: string | undefined | null, trackingNumber: string): string {
  const key = (carrier ?? '').toLowerCase();
  const encoded = encodeURIComponent(trackingNumber);
  if (key.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
  if (key.includes('ups')) return `https://www.ups.com/track?tracknum=${encoded}`;
  if (key.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
  if (key.includes('dhl')) return `https://www.dhl.com/en/express/tracking.html?AWB=${encoded}`;
  return `https://www.google.com/search?q=${encoded}+tracking`;
}
