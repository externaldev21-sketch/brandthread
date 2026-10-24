/**
 * What is still refundable on a buyer order: the order total minus what has
 * already been refunded (orders.refunded_cents, or the delivery guarantee's
 * auto-refund when that is all the response carries). Clamped at 0, so a
 * fully refunded order says so instead of quoting the full total again.
 *
 * Pure, unit-tested in tests/refund-remaining.test.ts.
 */
export interface RefundableOrder {
  payment: { totalCents: number };
  refundedCents?: number | null;
  delivery?: { autoRefund?: { refundedCents: number } | null } | null;
}

function cents(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function priorRefundedCents(order: RefundableOrder): number {
  return Math.max(cents(order.refundedCents), cents(order.delivery?.autoRefund?.refundedCents));
}

export function remainingRefundableCents(order: RefundableOrder): number {
  return Math.max(0, cents(order.payment.totalCents) - priorRefundedCents(order));
}
