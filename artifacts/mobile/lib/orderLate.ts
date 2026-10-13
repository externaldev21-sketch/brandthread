/**
 * "Late" = a paid order that still hasn't shipped more than 48 hours after it
 * was paid (or created, when the row has no payment timestamp).
 *
 * Exactly 48h is not late yet; one millisecond past is. Shipped, delivered,
 * cancelled, refunded and disputed orders are never late, nor is an order
 * with tracking on it, nor an unpaid one (nothing to ship until it's paid).
 */
import type { OrderStatus, PaymentStatus } from '@/services/orderTypes';

export const LATE_AFTER_MS = 48 * 60 * 60 * 1000;

const SHIPPABLE: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['new', 'processing', 'ready_to_ship']);
const UNPAID: ReadonlySet<string> = new Set(['pending', 'authorized', 'failed', 'voided']);

export interface LateCheckOrder {
  status: OrderStatus;
  paymentStatus: PaymentStatus | string;
  createdAt: string;
  paidAt?: string | null;
  shipments?: ReadonlyArray<{ trackingNumber?: string | null }>;
}

export function isOrderLate(order: LateCheckOrder, now: Date | number = Date.now()): boolean {
  if (!SHIPPABLE.has(order.status)) return false;
  if (UNPAID.has(order.paymentStatus)) return false;
  if (order.shipments?.some(s => !!s.trackingNumber)) return false;
  const since = Date.parse(order.paidAt || order.createdAt);
  if (!Number.isFinite(since)) return false;
  const nowMs = typeof now === 'number' ? now : now.getTime();
  return nowMs - since > LATE_AFTER_MS;
}
