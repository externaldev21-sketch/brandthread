/**
 * Seller orders "look less AI" items 75-78: status dot mapping, the Late
 * rule (48h boundary) and the money receipt arithmetic.
 */
import { describe, expect, it } from 'vitest';
import { orderStatusDot, statusDotColor } from '../lib/orderStatusDot';
import { isOrderLate, LATE_AFTER_MS } from '../lib/orderLate';
import { buildOrderReceipt, receiptAmount } from '../lib/orderReceipt';
import { previewSellerOrders } from '../lib/previewSellerOrders';
import { dbStatusToOrderStatus, dbStatusToPaymentStatus } from '../lib/orderStatusAdapter';

describe('orderStatusDot (item 75)', () => {
  it('maps the three moving states to Pending / Paid / Shipped with gray / white / silver dots', () => {
    expect(orderStatusDot({ status: 'new', paymentStatus: 'pending' })).toEqual({ label: 'Pending', tone: 'border', filled: true });
    expect(orderStatusDot({ status: 'new', paymentStatus: 'paid' })).toEqual({ label: 'Paid', tone: 'text', filled: true });
    expect(orderStatusDot({ status: 'processing', paymentStatus: 'paid' })).toEqual({ label: 'Paid', tone: 'text', filled: true });
    expect(orderStatusDot({ status: 'ready_to_ship', paymentStatus: 'paid' })).toEqual({ label: 'Paid', tone: 'text', filled: true });
    expect(orderStatusDot({ status: 'shipped', paymentStatus: 'paid' })).toEqual({ label: 'Shipped', tone: 'muted', filled: true });
  });

  it('gives stopped orders a neutral ring + word', () => {
    expect(orderStatusDot({ status: 'delivered', paymentStatus: 'paid' })).toEqual({ label: 'Delivered', tone: 'muted', filled: false });
    expect(orderStatusDot({ status: 'cancelled', paymentStatus: 'voided' })).toEqual({ label: 'Cancelled', tone: 'border', filled: false });
    expect(orderStatusDot({ status: 'refunded', paymentStatus: 'refunded' })).toEqual({ label: 'Refunded', tone: 'border', filled: false });
    expect(orderStatusDot({ status: 'disputed', paymentStatus: 'partially_refunded' })).toEqual({ label: 'Disputed', tone: 'text', filled: false });
  });

  it('a paid checkout stored as DB "pending" reads Paid, an unpaid one reads Pending', () => {
    const paid = { status: dbStatusToOrderStatus('pending'), paymentStatus: dbStatusToPaymentStatus('pending', '2026-10-01T00:00:00Z') };
    const unpaid = { status: dbStatusToOrderStatus('pending'), paymentStatus: dbStatusToPaymentStatus('pending', null) };
    expect(orderStatusDot(paid).label).toBe('Paid');
    expect(orderStatusDot(unpaid).label).toBe('Pending');
  });

  it('every DB status maps to a label (no raw enum ever reaches the UI)', () => {
    for (const db of ['pending', 'processing', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded', 'refund_pending', 'disputed']) {
      const spec = orderStatusDot({ status: dbStatusToOrderStatus(db), paymentStatus: dbStatusToPaymentStatus(db, null) });
      expect(['Pending', 'Paid', 'Shipped', 'Delivered', 'Cancelled', 'Refunded', 'Disputed']).toContain(spec.label);
    }
  });

  it('tones resolve to theme tokens only', () => {
    const theme = { text: 'T', muted: 'M', border: 'B' };
    expect(statusDotColor('text', theme)).toBe('T');
    expect(statusDotColor('muted', theme)).toBe('M');
    expect(statusDotColor('border', theme)).toBe('B');
  });
});

describe('isOrderLate (item 76)', () => {
  const paidAt = '2026-10-10T12:00:00.000Z';
  const t0 = Date.parse(paidAt);
  const base = { status: 'processing' as const, paymentStatus: 'paid', createdAt: '2026-10-10T11:00:00.000Z', paidAt };

  it('is not late at exactly 48h, late one millisecond after', () => {
    expect(LATE_AFTER_MS).toBe(48 * 3600 * 1000);
    expect(isOrderLate(base, t0 + LATE_AFTER_MS)).toBe(false);
    expect(isOrderLate(base, t0 + LATE_AFTER_MS + 1)).toBe(true);
    expect(isOrderLate(base, t0 + LATE_AFTER_MS - 1)).toBe(false);
  });

  it('counts from paidAt, falling back to createdAt', () => {
    const noPaidAt = { ...base, paidAt: null };
    const created = Date.parse(base.createdAt);
    expect(isOrderLate(noPaidAt, created + LATE_AFTER_MS + 1)).toBe(true);
    expect(isOrderLate(noPaidAt, created + LATE_AFTER_MS)).toBe(false);
  });

  it('excludes cancelled, refunded, shipped, delivered and disputed orders', () => {
    const later = t0 + 10 * LATE_AFTER_MS;
    for (const status of ['cancelled', 'refunded', 'shipped', 'delivered', 'disputed'] as const) {
      expect(isOrderLate({ ...base, status }, later)).toBe(false);
    }
  });

  it('includes every unshipped paid state (new, processing, ready to ship)', () => {
    const later = t0 + LATE_AFTER_MS + 1;
    for (const status of ['new', 'processing', 'ready_to_ship'] as const) {
      expect(isOrderLate({ ...base, status }, later)).toBe(true);
    }
  });

  it('excludes unpaid orders and orders that already have tracking', () => {
    const later = t0 + 10 * LATE_AFTER_MS;
    expect(isOrderLate({ ...base, paymentStatus: 'pending' }, later)).toBe(false);
    expect(isOrderLate({ ...base, shipments: [{ trackingNumber: '1Z999' }] }, later)).toBe(false);
    expect(isOrderLate({ ...base, shipments: [{ trackingNumber: null }] }, later)).toBe(true);
  });

  it('never flags an order with an unreadable date', () => {
    expect(isOrderLate({ ...base, paidAt: null, createdAt: 'not a date' }, Date.now())).toBe(false);
  });
});

describe('buildOrderReceipt (item 78)', () => {
  const sum = (r: ReturnType<typeof buildOrderReceipt>) => r.lines.reduce((acc, l) => acc + l.cents, 0);

  it('lists item total, shipping, Brandthread fee and Stripe fee from the recorded columns, and the lines add up to the payout', () => {
    // A destination charge as recordOrderPaid writes it: net = gross - platform - processing charged.
    const r = buildOrderReceipt({
      totalCents: 4400, subtotalCents: 3800, shippingCents: 600,
      platformFeeCents: 220, processingFeeChargedCents: 158, sellerNetCents: 4022,
    });
    expect(r.lines.map(l => [l.label, l.cents])).toEqual([
      ['Item total', 3800], ['Shipping', 600], ['Brandthread fee', -220], ['Stripe fee', -158],
    ]);
    expect(r.feesRecorded).toBe(true);
    expect(r.payoutCents).toBe(4022);
    expect(sum(r)).toBe(r.payoutCents);
  });

  it('keeps tax and the seller promo in the receipt, and still adds up', () => {
    const r = buildOrderReceipt({
      totalCents: 9500, subtotalCents: 10_000, shippingCents: 0, taxCents: 500, discountAmountCents: 1000,
      platformFeeCents: 475, processingFeeChargedCents: 306, sellerNetCents: 9500 - 475 - 306,
    });
    expect(r.lines.map(l => l.key)).toEqual(['items', 'discount', 'tax', 'platform_fee', 'stripe_fee']);
    expect(r.lines.find(l => l.key === 'discount')!.cents).toBe(-1000);
    expect(sum(r)).toBe(r.payoutCents);
  });

  it('Thread Cash is not a deduction: Brandthread pays it on top, so the payout matches a card-only sale', () => {
    // Buyer used $10 Thread Cash on a $100 item: card charge $90.
    const r = buildOrderReceipt({
      totalCents: 9000, subtotalCents: 10_000, discountAmountCents: 1000, threadCashAppliedCents: 1000,
      platformFeeCents: 450, processingFeeChargedCents: 291, sellerNetCents: 9000 - 450 - 291,
    });
    expect(r.lines.some(l => l.key === 'discount')).toBe(false);
    expect(r.payoutCents).toBe(9000 - 450 - 291 + 1000);
    expect(sum(r)).toBe(r.payoutCents);
  });

  it('never invents fees: with no recorded split it ends at the order total and has no payout', () => {
    const r = buildOrderReceipt({ totalCents: 4400, subtotalCents: 3800, shippingCents: 600 });
    expect(r.feesRecorded).toBe(false);
    expect(r.payoutCents).toBeNull();
    expect(r.lines.map(l => l.key)).toEqual(['items', 'shipping']);
    expect(r.orderTotalCents).toBe(4400);
  });

  it('formats deductions with a true minus sign', () => {
    const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
    expect(receiptAmount(-158, fmt)).toBe('−$1.58');
    expect(receiptAmount(3800, fmt)).toBe('$38.00');
  });
});

describe('demo seller orders (demo=1 only) carry fee data and include a late order', () => {
  it('every paid demo order has a receipt that adds up, and at least one is late', () => {
    const now = new Date('2026-10-13T15:00:00');
    const rows = previewSellerOrders(now, 120);
    const paid = rows.filter(r => r.status !== 'cancelled' && typeof r.sellerNetCents === 'number');
    expect(paid.length).toBeGreaterThan(0);
    for (const row of paid) {
      const r = buildOrderReceipt(row);
      expect(r.feesRecorded).toBe(true);
      expect(r.lines.reduce((a, l) => a + l.cents, 0)).toBe(r.payoutCents);
    }
    const late = rows.filter(row => isOrderLate({
      status: dbStatusToOrderStatus(row.status),
      paymentStatus: dbStatusToPaymentStatus(row.status, row.paidAt),
      createdAt: row.createdAt, paidAt: row.paidAt,
      shipments: row.trackingNumber ? [{ trackingNumber: row.trackingNumber }] : [],
    }, now));
    expect(late.length).toBeGreaterThan(0);
  });
});

describe('order detail section order (item 77) and status wiring (item 75)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path');
  const detail = fs.readFileSync(path.resolve(__dirname, '../app/order-detail.tsx'), 'utf8');
  const list = fs.readFileSync(path.resolve(__dirname, '../app/(tabs)/orders.tsx'), 'utf8');
  // The integration uses the grouped fulfilment screen, not the former tab helpers.
  const overview = detail.slice(detail.indexOf('testID="order-detail-scroll"'));

  it('reads buyer -> items and shipping -> money, retaining risk / pre-order warnings', () => {
    const at = (needle: string) => {
      const i = overview.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const order = [
      at('testID="order-customer"'),
      at('testID="order-fulfilled-block"'),
      at('testID="order-tracking-box"'),
      at('testID="order-unfulfilled-block"'),
      at('testID="order-paid-block"'),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(overview).toContain('<OrderRiskBadge');
    expect(overview).toContain('order.isPreOrder');
    expect(overview).toContain('<FeesRow payment={order.payment}');
  });

  it('keeps every fulfil / ship / label / refund action', () => {
    for (const action of ['Mark as processing', 'Mark as ready to ship', 'Fulfill items', 'Create shipping label', 'Update delivery status', 'Cancel order', "label=\"Refund\""]) {
      expect(detail, action).toContain(action);
    }
  });

  it('list rows and the detail header use the dot + word, not coloured badges', () => {
    expect(list).toContain('<OrderStatusDot');
    expect(list).toContain('late={isOrderLate(order)}');
    expect(list).not.toContain('getPaymentLabel(');
    expect(overview).toContain('<OrderStatusDot');
    expect(overview).not.toContain('orderStatusVariant(');
  });
});
