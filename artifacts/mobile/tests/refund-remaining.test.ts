import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { priorRefundedCents, remainingRefundableCents } from '@/lib/refundRemaining';
import { mapApiBuyerOrder } from '@/services/orderService';

const read = (file: string) => readFileSync(path.resolve(__dirname, '..', file), 'utf8');

describe('max refund after earlier refunds (buyer refund request)', () => {
  it('quotes the full total when nothing was refunded', () => {
    expect(remainingRefundableCents({ payment: { totalCents: 5000 } })).toBe(5000);
    expect(remainingRefundableCents({ payment: { totalCents: 5000 }, refundedCents: 0 })).toBe(5000);
  });

  it('subtracts a partial refund', () => {
    expect(remainingRefundableCents({ payment: { totalCents: 5000 }, refundedCents: 1250 })).toBe(3750);
  });

  it('uses the auto-refund when the order row has no refundedCents', () => {
    const order = { payment: { totalCents: 5000 }, delivery: { autoRefund: { refundedCents: 2000 } } };
    expect(priorRefundedCents(order)).toBe(2000);
    expect(remainingRefundableCents(order)).toBe(3000);
  });

  it('clamps at 0 when fully (or over) refunded', () => {
    expect(remainingRefundableCents({ payment: { totalCents: 5000 }, refundedCents: 5000 })).toBe(0);
    expect(remainingRefundableCents({ payment: { totalCents: 5000 }, refundedCents: 9000 })).toBe(0);
  });

  it('ignores junk values', () => {
    expect(remainingRefundableCents({ payment: { totalCents: 5000 }, refundedCents: -10 })).toBe(5000);
    expect(remainingRefundableCents({ payment: { totalCents: 5000 }, refundedCents: 1.5 })).toBe(5000);
  });

  it('maps refundedCents from GET /api/buyer/orders/:id (delivery columns) onto the order', () => {
    expect(mapApiBuyerOrder({ id: 'o1', orderNumber: 'BT-1', totalCents: 5000, refundedCents: 1200 }).refundedCents).toBe(1200);
    expect('refundedCents' in mapApiBuyerOrder({ id: 'o1', orderNumber: 'BT-1', totalCents: 5000 })).toBe(false);
  });

  it('the screen quotes the remaining amount and offers no submit once fully refunded', () => {
    const src = read('app/buyer-refund-request.tsx');
    expect(src).toContain('remainingRefundableCents(order)');
    expect(src).toContain('{fullyRefunded ? null : (');
    expect(src).not.toContain('Alert.alert');
  });
});
