import { describe, expect, it } from 'vitest';
import {
  processingTimeLine, readSellerPolicies, readSellerShipping, sellerAcceptsReturns, shippingCostLine,
} from './productTrust';
import { buildProductShareLink, normalizeReferralCode, productShareMessage } from './productShare';

describe('readSellerPolicies', () => {
  it('reads the seller policy fields from the public product row', () => {
    expect(readSellerPolicies({ sellerReturnPolicy: ' 30 day returns ', sellerCancellationPolicy: 'Cancel within 1 hour' }))
      .toEqual({ refundPolicy: '30 day returns', cancellationPolicy: 'Cancel within 1 hour' });
  });

  it('returns empty strings, never invented copy, when the seller has none', () => {
    expect(readSellerPolicies({})).toEqual({ refundPolicy: '', cancellationPolicy: '' });
    expect(readSellerPolicies(null)).toEqual({ refundPolicy: '', cancellationPolicy: '' });
    expect(readSellerPolicies({ sellerReturnPolicy: null, sellerCancellationPolicy: 42 })).toEqual({ refundPolicy: '', cancellationPolicy: '' });
  });
});

describe('readSellerShipping', () => {
  it('reads a valid summary', () => {
    expect(readSellerShipping({ sellerShipping: { rateCents: 595, freeAboveCents: 7500, processingDays: 2 } }))
      .toEqual({ rateCents: 595, freeAboveCents: 7500, processingDays: 2 });
  });

  it('returns null when absent or empty', () => {
    expect(readSellerShipping({})).toBeNull();
    expect(readSellerShipping({ sellerShipping: null })).toBeNull();
    expect(readSellerShipping({ sellerShipping: { rateCents: null, freeAboveCents: null, processingDays: null } })).toBeNull();
    expect(readSellerShipping({ sellerShipping: { rateCents: -5, processingDays: 'two' } })).toBeNull();
  });
});

describe('shippingCostLine', () => {
  it('formats rate + free threshold', () => {
    expect(shippingCostLine({ rateCents: 595, freeAboveCents: 7500, processingDays: null })).toBe('Shipping $5.95 · Free over $75');
    expect(shippingCostLine({ rateCents: 800, freeAboveCents: null, processingDays: null })).toBe('Shipping $8');
    expect(shippingCostLine({ rateCents: null, freeAboveCents: 5000, processingDays: 2 })).toBe('Free shipping over $50');
  });

  it('says free shipping when the rate or threshold is zero', () => {
    expect(shippingCostLine({ rateCents: 0, freeAboveCents: null, processingDays: null })).toBe('Free shipping');
    expect(shippingCostLine({ rateCents: 500, freeAboveCents: 0, processingDays: null })).toBe('Free shipping');
  });

  it('hides the line with no rate', () => {
    expect(shippingCostLine(null)).toBeNull();
    expect(shippingCostLine({ rateCents: null, freeAboveCents: null, processingDays: 3 })).toBeNull();
  });
});

describe('processingTimeLine', () => {
  it("uses the seller's processing days", () => {
    expect(processingTimeLine({ rateCents: null, freeAboveCents: null, processingDays: 3 }, false)).toBe('Ships in 3 business days');
    expect(processingTimeLine({ rateCents: null, freeAboveCents: null, processingDays: 1 }, false)).toBe('Ships in 1 business day');
  });

  it('hides for pre-orders and when unset', () => {
    expect(processingTimeLine({ rateCents: null, freeAboveCents: null, processingDays: 3 }, true)).toBeNull();
    expect(processingTimeLine({ rateCents: 500, freeAboveCents: null, processingDays: null }, false)).toBeNull();
    expect(processingTimeLine(null, false)).toBeNull();
  });
});

describe('sellerAcceptsReturns', () => {
  it('is true only for policies that plainly offer returns', () => {
    expect(sellerAcceptsReturns('Returns accepted within 30 days of delivery.')).toBe(true);
    expect(sellerAcceptsReturns('Free exchanges within 14 days.')).toBe(true);
    expect(sellerAcceptsReturns('Full refund within 7 days.')).toBe(true);
  });

  it('is false for no-returns, limited or missing policies', () => {
    expect(sellerAcceptsReturns('All sales final.')).toBe(false);
    expect(sellerAcceptsReturns('No returns.')).toBe(false);
    expect(sellerAcceptsReturns('Final sale items are non-returnable.')).toBe(false);
    expect(sellerAcceptsReturns('Returns accepted only for damaged or incorrect items.')).toBe(false);
    expect(sellerAcceptsReturns('We do not accept returns')).toBe(false);
    expect(sellerAcceptsReturns('Ships from Brooklyn.')).toBe(false);
    expect(sellerAcceptsReturns('')).toBe(false);
    expect(sellerAcceptsReturns(undefined)).toBe(false);
  });
});

describe('buildProductShareLink', () => {
  it('builds the canonical product URL', () => {
    expect(buildProductShareLink('prod_abc123')).toBe('https://brandthread.app/store/product/prod_abc123');
  });

  it("appends the buyer's referral code when there is one", () => {
    expect(buildProductShareLink('prod_abc123', 'ab-12cd')).toBe('https://brandthread.app/store/product/prod_abc123?ref=AB12CD');
    expect(buildProductShareLink('prod_abc123', '')).toBe('https://brandthread.app/store/product/prod_abc123');
    expect(buildProductShareLink('prod_abc123', 'x')).toBe('https://brandthread.app/store/product/prod_abc123');
  });

  it('returns null for an invalid id', () => {
    expect(buildProductShareLink('bad id')).toBeNull();
    expect(buildProductShareLink(undefined, 'ABCD12')).toBeNull();
  });

  it('normalises codes and builds a plain message', () => {
    expect(normalizeReferralCode('abcd1234efgh9999')).toBe('ABCD1234EFGH');
    expect(productShareMessage('Heavy Tee')).toBe('Heavy Tee on Brandthread');
    expect(productShareMessage('')).toBe('This on Brandthread');
  });
});
