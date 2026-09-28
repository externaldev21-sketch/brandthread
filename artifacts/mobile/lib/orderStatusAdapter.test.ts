import { describe, expect, it } from 'vitest';
import { dbStatusToOrderStatus, dbStatusToPaymentStatus } from './orderStatusAdapter';

describe('orderStatusAdapter — buyer checkout order as the seller sees it', () => {
  it('shows a paid checkout order (status pending + paidAt) as New and Paid', () => {
    // Shape the checkout webhook writes: status "pending", paidAt = Stripe payment time.
    expect(dbStatusToOrderStatus('pending')).toBe('new');
    expect(dbStatusToPaymentStatus('pending', '2026-09-28T02:00:00.000Z')).toBe('paid');
    expect(dbStatusToPaymentStatus('pending', new Date())).toBe('paid');
  });

  it('keeps an unpaid pending order (no paidAt) as Pending', () => {
    expect(dbStatusToPaymentStatus('pending')).toBe('pending');
    expect(dbStatusToPaymentStatus('pending', null)).toBe('pending');
  });

  it('never lets paidAt override a terminal / refund status', () => {
    const paidAt = '2026-09-28T02:00:00.000Z';
    expect(dbStatusToPaymentStatus('refunded', paidAt)).toBe('refunded');
    expect(dbStatusToPaymentStatus('cancelled', paidAt)).toBe('voided');
    expect(dbStatusToPaymentStatus('refund_pending', paidAt)).toBe('authorized');
    expect(dbStatusToPaymentStatus('shipped', paidAt)).toBe('paid');
  });
});
