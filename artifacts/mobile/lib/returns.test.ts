import { describe, expect, it } from 'vitest';
import {
  activeReturnFor, adaptReturnRow, isReturnEligible, itemsTotalCents, refundDestination, refundMethodForResolution,
  resolutionForRefundMethod, returnHeadline, returnReasonLabel, returnSteps, returnSubmitError, statusLabel,
  apiErrorMessage, parseRefundAmount, quickApproveMessage,
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
    // Item 124: a real date (refund time + 10 business days), not fixed copy.
    expect(returnHeadline({ ...refunded, updatedAt: new Date(2026, 9, 13, 12).toISOString() }, 'buyer', money).body)
      .toMatch(/^Back to your original payment method\. Expected by .+\.$/);
    expect(adaptReturnRow({ ...row, returnLabelUrl: 'https://shippo.test/label.pdf', returnTrackingNumber: '9400' }).returnLabelUrl)
      .toBe('https://shippo.test/label.pdf');
    expect(adaptReturnRow(row).returnLabelUrl).toBeNull();
    const denied = adaptReturnRow({ ...row, status: 'denied', sellerResponse: 'Tags were removed.' });
    expect(returnHeadline(denied, 'buyer', money)).toEqual({ title: 'Return declined', body: 'Northline Studio: “Tags were removed.”' });
    expect(returnHeadline(adaptReturnRow({ ...row, status: 'approved' }), 'seller', money).title).toBe('Approved, refund not issued yet');
  });

  it('reads the prepaid return label and refund-on-scan', () => {
    const v = adaptReturnRow({ ...row, status: 'approved', refundOnScan: true, refundAmountCents: 2000, returnLabelUrl: 'https://l/1.pdf', returnCarrier: 'USPS', returnTrackingNumber: '9400' });
    expect(v).toMatchObject({ refundOnScan: true, returnLabelUrl: 'https://l/1.pdf', returnCarrier: 'USPS', returnTrackingNumber: '9400' });
    expect(adaptReturnRow(row)).toMatchObject({ refundOnScan: false, returnLabelUrl: null });
    expect(returnHeadline(v, 'seller', money)).toEqual({
      title: 'Approved, refund on first scan',
      body: 'The refund of $20.00 is issued when the carrier first scans Jordan Reyes’s parcel.',
    });
    expect(returnHeadline(v, 'buyer', money).title).toBe('Return approved');
  });

  it('parses the seller refund amount', () => {
    expect(parseRefundAmount('24.99', 16000)).toEqual({ cents: 2499 });
    expect(parseRefundAmount('$160', 16000)).toEqual({ cents: 16000 });
    expect(parseRefundAmount('160.01', 16000)).toHaveProperty('error');
    expect(parseRefundAmount('0', 16000)).toHaveProperty('error');
    expect(parseRefundAmount('abc', 16000)).toHaveProperty('error');
  });

  it('reads both server error shapes', () => {
    expect(apiErrorMessage({ body: '{"error":"This return is already denied"}' }, 'x')).toBe('This return is already denied');
    expect(apiErrorMessage({ body: '{"error":{"message":"Unavailable","code":"dev_preview_offline"}}' }, 'x')).toBe('Unavailable');
    expect(apiErrorMessage({ body: 'oops' }, 'fallback')).toBe('fallback');
    expect(apiErrorMessage(null, 'fallback')).toBe('fallback');
  });

  it('one-tap approve toast says what happened', () => {
    expect(quickApproveMessage({ status: 'refunded', refundAmountCents: 16000 }, money)).toBe('Refunded $160.00');
    expect(quickApproveMessage({ status: 'approved' }, money)).toBe('Approved. Open the return to retry the refund.');
  });

  it('steps come from real status and timestamps', () => {
    const v = adaptReturnRow(row);
    expect(returnSteps(v).map(s => `${s.key}:${s.state}`)).toEqual(['requested:done', 'review:current', 'refund:upcoming']);
    expect(returnSteps(v, 'seller')[1].label).toBe('You review the request');
    expect(returnSteps(v, 'buyer')[1].label).toBe('Seller reviews your request');
    expect(returnSteps({ ...v, status: 'refunded', updatedAt: '2026-09-22T09:00:00Z' }).map(s => `${s.key}:${s.state}`))
      .toEqual(['requested:done', 'review:done', 'refund:current', 'arrives:upcoming']);
    expect(returnSteps({ ...v, status: 'refunded', updatedAt: '2026-09-22T09:00:00Z' }, 'seller').map(s => s.key))
      .toEqual(['requested', 'review', 'refund']);
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

describe('isRefundEligible', () => {
  it('offers a refund while the order is on its way, a return once delivered', async () => {
    const { isRefundEligible, isReturnEligible } = await import('./returns');
    expect(isRefundEligible('shipped')).toBe(true);
    expect(isRefundEligible('fulfilled')).toBe(true);
    expect(isRefundEligible('delivered')).toBe(false);
    expect(isReturnEligible('delivered')).toBe(true);
    expect(isRefundEligible('processing')).toBe(false);
    expect(isRefundEligible(undefined)).toBe(false);
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
