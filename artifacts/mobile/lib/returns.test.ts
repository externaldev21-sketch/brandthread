import { describe, expect, it } from 'vitest';
import {
  activeReturnFor, adaptReturnRow, isReturnEligible, itemsTotalCents, refundDestination, refundMethodForResolution,
  resolutionForRefundMethod, returnHeadline, returnReasonLabel, returnSteps, returnSubmitError, statusLabel,
} from './returns';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const row = {
  id: 'ret_1', orderId: 'ord_1', orderNumber: 'BT-00042', buyerId: 'user_buyer', sellerId: 'user_seller',
  buyerName: 'Jordan Reyes', sellerName: 'Northline Studio', status: 'pending', reason: 'damaged',
  notes: 'Seam split.', evidenceUrls: ['https://signed/1', 42], totalCents: 16000,
  requestedItems: [{ lineItemId: 'li_1', productName: 'Ember Hoodie', variantTitle: 'Charcoal / M', quantity: 1, unitPriceCents: 14800 }],
  refundAmountCents: null, sellerResponse: null, createdAt: '2026-09-20T10:00:00Z', updatedAt: '2026-09-20T10:00:00Z',
};

describe('lib/returns', () => {
  it('adapts a GET /api/returns row (server vocabulary, names, signed photo URLs only)', () => {
    const view = adaptReturnRow(row);
    expect(view).toMatchObject({ status: 'pending', buyerName: 'Jordan Reyes', sellerName: 'Northline Studio', orderTotalCents: 16000 });
    expect(view.evidenceUrls).toEqual(['https://signed/1']);
    expect(view.items).toEqual([{ lineItemId: 'li_1', productName: 'Ember Hoodie', variantTitle: 'Charcoal / M', quantity: 1, unitPriceCents: 14800 }]);
    expect(adaptReturnRow({ ...row, status: 'under_review', buyerName: null }).status).toBe('pending');
    expect(adaptReturnRow({ ...row, buyerName: null }).buyerName).toBe('Buyer');
    expect(itemsTotalCents(view.items)).toBe(14800);
  });

  it('only delivered orders can start a return; an open return blocks another, a declined one does not', () => {
    expect(isReturnEligible('delivered')).toBe(true);
    for (const status of ['new', 'processing', 'shipped', 'cancelled', undefined]) expect(isReturnEligible(status)).toBe(false);
    expect(activeReturnFor([{ orderId: 'ord_1', status: 'denied' }], 'ord_1')).toBeNull();
    expect(activeReturnFor([{ orderId: 'ord_1', status: 'denied' }, { orderId: 'ord_1', status: 'pending', id: 'r2' }], 'ord_1')).toMatchObject({ id: 'r2' });
    expect(activeReturnFor([{ orderId: 'ord_2', status: 'pending' }], 'ord_1')).toBeNull();
  });

  it('headline per status and per side', () => {
    const v = adaptReturnRow(row);
    expect(returnHeadline(v, 'buyer', money).title).toBe('Waiting for Northline Studio');
    expect(returnHeadline(v, 'seller', money)).toMatchObject({ title: 'Review this return' });
    expect(returnHeadline(v, 'seller', money).body).toContain('Jordan Reyes');
    const refunded = adaptReturnRow({ ...row, status: 'refunded', refundAmountCents: 16000 });
    expect(returnHeadline(refunded, 'buyer', money).title).toBe('Refunded $160.00');
    const denied = adaptReturnRow({ ...row, status: 'denied', sellerResponse: 'Tags were removed.' });
    expect(returnHeadline(denied, 'buyer', money)).toEqual({ title: 'Return declined', body: 'Northline Studio: “Tags were removed.”' });
    expect(returnHeadline(adaptReturnRow({ ...row, status: 'approved' }), 'seller', money).title).toBe('Approved, refund not issued yet');
  });

  it('steps come from real status and timestamps', () => {
    const v = adaptReturnRow(row);
    expect(returnSteps(v).map(s => `${s.key}:${s.state}`)).toEqual(['requested:done', 'review:current', 'refund:upcoming']);
    expect(returnSteps(v, 'seller')[1].label).toBe('You review the request');
    expect(returnSteps(v, 'buyer')[1].label).toBe('Seller reviews your request');
    expect(returnSteps({ ...v, status: 'refunded', updatedAt: '2026-09-22T09:00:00Z' }).map(s => `${s.key}:${s.state}`))
      .toEqual(['requested:done', 'review:done', 'refund:current']);
    const declined = returnSteps({ ...v, status: 'denied', updatedAt: '2026-09-21T09:00:00Z' });
    expect(declined.map(s => s.key)).toEqual(['requested', 'declined']);
    expect(declined[1].at).toBe('2026-09-21T09:00:00Z');
  });

  it('labels and submit errors', () => {
    expect(returnReasonLabel('damaged')).toBe('Damaged on arrival');
    expect(returnReasonLabel('too_small')).toBe('too small');
    expect(statusLabel('denied')).toBe('Declined');
    expect(returnSubmitError({ status: 409 })).toEqual({ message: 'You already have an open return for this order.', alreadyExists: true });
    expect(returnSubmitError({ status: 400, body: JSON.stringify({ error: 'Attach up to 5 photos uploaded with this return request' }) }).message)
      .toBe('Attach up to 5 photos uploaded with this return request');
    expect(returnSubmitError(new TypeError('Network request failed')).message).toMatch(/connection/);
  });
});

describe('refund methods (items 113/114)', () => {
  const base = { id: 'r1', orderId: 'o1', orderNumber: '1001', buyerName: 'Sam', sellerName: 'Atelier', status: 'refunded', refundAmountCents: 2500 };

  it('maps resolutions to methods and back', () => {
    expect(refundMethodForResolution('refund')).toBe('original');
    expect(refundMethodForResolution('exchange')).toBe('original');
    expect(refundMethodForResolution('thread_cash')).toBe('thread_cash');
    expect(refundMethodForResolution('store_credit')).toBe('store_credit');
    expect(resolutionForRefundMethod('original')).toBe('refund');
    expect(resolutionForRefundMethod('thread_cash')).toBe('thread_cash');
  });

  it('prefers how the refund was actually paid over what was asked', () => {
    expect(adaptReturnRow({ ...base, resolutionRequested: 'thread_cash' }).refundMethod).toBe('thread_cash');
    expect(adaptReturnRow({ ...base, resolutionRequested: 'thread_cash', refundMethod: 'original' }).refundMethod).toBe('original');
    expect(adaptReturnRow({ ...base, resolutionRequested: 'store_credit', refundMethod: null }).refundMethod).toBe('store_credit');
  });

  it('tells each side where the money went', () => {
    const tc = adaptReturnRow({ ...base, resolutionRequested: 'thread_cash' });
    expect(returnHeadline(tc, 'buyer', money).body).toContain('Thread Cash');
    expect(returnHeadline(tc, 'seller', money).body).toBe('Refunded to Sam’s Thread Cash.');
    const sc = adaptReturnRow({ ...base, resolutionRequested: 'store_credit' });
    expect(returnHeadline(sc, 'buyer', money).body).toContain('Atelier store credit');
    const pending = adaptReturnRow({ ...base, status: 'pending', resolutionRequested: 'store_credit' });
    expect(returnSteps(pending, 'buyer').at(-1)?.label).toBe('Refund to store credit at Atelier');
    expect(returnSteps(adaptReturnRow({ ...base, status: 'pending' }), 'buyer').at(-1)?.label).toBe('Refund to your original payment');
    expect(refundDestination('thread_cash', 'seller', { buyerName: 'Sam', sellerName: 'Atelier' })).toBe('Sam’s Thread Cash');
  });
});
