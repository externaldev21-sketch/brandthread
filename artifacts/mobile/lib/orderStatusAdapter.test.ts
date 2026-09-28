import { describe, expect, it } from 'vitest';
import {
  dbStatusToOrderStatus, dbStatusToPaymentStatus,
  orderStatusBadgeLabel, orderStatusBadgeVariant, carrierTrackingUrl,
} from './orderStatusAdapter';

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

describe('orderStatusBadgeLabel / orderStatusBadgeVariant — chat order card (item 71)', () => {
  it('labels and colors a shipped order the same way the order detail screen does', () => {
    expect(orderStatusBadgeLabel('shipped')).toBe('SHIPPED');
    expect(orderStatusBadgeVariant('shipped')).toBe('warning');
  });

  it('shows a delivered order as a success badge', () => {
    expect(orderStatusBadgeLabel('delivered')).toBe('DELIVERED');
    expect(orderStatusBadgeVariant('delivered')).toBe('success');
  });

  it('shows cancelled/refunded/disputed orders honestly, never a stale "processing" look', () => {
    expect(orderStatusBadgeLabel('cancelled')).toBe('CANCELLED');
    expect(orderStatusBadgeVariant('cancelled')).toBe('neutral');
    expect(orderStatusBadgeLabel('refunded')).toBe('REFUNDED');
    expect(orderStatusBadgeVariant('refunded')).toBe('error');
    expect(orderStatusBadgeLabel('disputed')).toBe('DISPUTED');
    expect(orderStatusBadgeVariant('disputed')).toBe('error');
  });

  it('composes end-to-end from a raw DB status through to a badge', () => {
    const uiStatus = dbStatusToOrderStatus('fulfilled');
    expect(uiStatus).toBe('ready_to_ship');
    expect(orderStatusBadgeLabel(uiStatus)).toBe('READY TO SHIP');
    expect(orderStatusBadgeVariant(uiStatus)).toBe('warning');
  });
});

describe('carrierTrackingUrl — chat order card Track action (item 71)', () => {
  it('builds a real UPS tracking URL', () => {
    expect(carrierTrackingUrl('UPS', '1Z999AA10123456784')).toBe(
      'https://www.ups.com/track?tracknum=1Z999AA10123456784',
    );
  });

  it('builds a real USPS tracking URL', () => {
    expect(carrierTrackingUrl('USPS', '9400111899223197428123')).toBe(
      'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223197428123',
    );
  });

  it('builds a real FedEx tracking URL', () => {
    expect(carrierTrackingUrl('FedEx', '789012345678')).toBe(
      'https://www.fedex.com/fedextrack/?trknbr=789012345678',
    );
  });

  it('falls back to a web search for an unrecognized/missing carrier', () => {
    expect(carrierTrackingUrl(undefined, 'ABC123')).toBe(
      'https://www.google.com/search?q=ABC123+tracking',
    );
    expect(carrierTrackingUrl('Some Regional Carrier', 'ABC123')).toBe(
      'https://www.google.com/search?q=ABC123+tracking',
    );
  });
});
