import { describe, expect, it } from 'vitest';
import { newRefundRequestId, parseRefundAmount, refundErrorMessage, refundReasonLabel } from './sellerRefund';

describe('parseRefundAmount', () => {
  it('parses dollars to cents within the refundable amount', () => {
    expect(parseRefundAmount('12.5', 5000)).toEqual({ ok: true, cents: 1250 });
    expect(parseRefundAmount('$50', 5000)).toEqual({ ok: true, cents: 5000 });
  });

  it('refuses empty, zero, malformed and over-limit amounts', () => {
    expect(parseRefundAmount('', 5000).ok).toBe(false);
    expect(parseRefundAmount('0', 5000).ok).toBe(false);
    expect(parseRefundAmount('1.234', 5000).ok).toBe(false);
    expect(parseRefundAmount('abc', 5000).ok).toBe(false);
    const over = parseRefundAmount('50.01', 5000);
    expect(over).toEqual({ ok: false, error: 'You can refund up to $50.00' });
  });
});

describe('newRefundRequestId', () => {
  it('matches the server format and differs per attempt', () => {
    const a = newRefundRequestId(1_700_000_000_000, () => 0.25);
    const b = newRefundRequestId(1_700_000_000_000, () => 0.75);
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(a).not.toBe(b);
  });
});

describe('refundReasonLabel / refundErrorMessage', () => {
  it('labels server reasons', () => {
    expect(refundReasonLabel('seller_refund')).toBe('Refund');
    expect(refundReasonLabel('return_approved')).toBe('Return refund');
    expect(refundReasonLabel('item_damaged')).toBe('Item damaged');
  });

  it('reads the server error and falls back', () => {
    expect(refundErrorMessage({ body: JSON.stringify({ error: 'Too much' }) })).toBe('Too much');
    expect(refundErrorMessage(new Error('x'))).toMatch(/couldn't be processed/);
  });
});
