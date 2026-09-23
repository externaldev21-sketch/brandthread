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

export function dbStatusToPaymentStatus(dbStatus: string): DbPaymentStatus {
  return DB_PAYMENT_STATUS_MAP[dbStatus] ?? 'pending';
}
