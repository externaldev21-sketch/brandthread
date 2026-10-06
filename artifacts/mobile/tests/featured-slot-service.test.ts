import { describe, expect, it } from 'vitest';
import {
  buildFeaturedReturnUrl, featuredStateLabel, needsStoreRefund, storeName, storeRefundUrl,
} from '@/services/featuredSlotService';

describe('featuredSlotService', () => {
  it('builds the deep link and web return URLs the server allowlist expects', () => {
    const id = '0b9f3c1e-6a47-4f43-8d5c-1f7a2f1d9e10';
    expect(buildFeaturedReturnUrl(id)).toBe(`brandthread://featured-slot/?id=${id}&paymentReturn=1`);
    expect(buildFeaturedReturnUrl(id, 'https://app.example.com')).toBe(`https://app.example.com/featured-slot?id=${id}&paymentReturn=1`);
  });

  it('labels every seller-facing state', () => {
    expect(featuredStateLabel('in_review')).toBe('In review');
    expect(featuredStateLabel('live')).toBe('Live');
    expect(featuredStateLabel('rejected')).toBe('Rejected');
    expect(featuredStateLabel('ended')).toBe('Ended');
  });

  // QA-0004: store-paid slots are refunded by Apple / Google, never by us.
  it('sends store-paid refunds to the right store', () => {
    expect(storeRefundUrl('ios')).toBe('https://reportaproblem.apple.com');
    expect(storeRefundUrl('android')).toContain('play.google.com');
    expect(storeRefundUrl('web')).toBeNull();
    expect(storeName('android')).toBe('Google Play');
    expect(storeName('ios')).toBe('the App Store');
  });

  it('knows which slots need a store refund', () => {
    expect(needsStoreRefund({ paidVia: 'store', refundStatus: 'none' })).toBe(true);
    expect(needsStoreRefund({ paidVia: null, refundStatus: 'store' })).toBe(true);
    expect(needsStoreRefund({ paidVia: 'stripe', refundStatus: 'refunded' })).toBe(false);
  });
});
