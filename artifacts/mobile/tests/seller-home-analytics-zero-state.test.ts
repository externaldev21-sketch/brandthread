import { describe, expect, it } from 'vitest';
import {
  selectSellerHomeAnalytics,
  sellerHomeAnalyticsKey,
  zeroSellerHomeAnalytics,
} from '@/lib/sellerHomeAnalytics';

describe('zeroSellerHomeAnalytics', () => {
  it('shows 0 / $0.00-equivalent counts and an empty bucket list, never fabricated numbers', () => {
    const zero = zeroSellerHomeAnalytics('today');
    expect(zero).toEqual({
      range: 'today',
      totalCents: 0,
      orderCount: 0,
      visitorCount: 0,
      toFulfill: 0,
      toCapture: 0,
      buckets: [],
    });
  });
});

describe('selectSellerHomeAnalytics', () => {
  it('returns a real zero state (not null, not fabricated) when there is no signed-in seller yet', () => {
    expect(selectSellerHomeAnalytics(null, null, 'today')).toEqual(zeroSellerHomeAnalytics('today'));
    expect(selectSellerHomeAnalytics(null, undefined, 'week')).toEqual(zeroSellerHomeAnalytics('week'));
  });

  it('returns null (loading/stale) rather than a fabricated zero once a real seller is known', () => {
    expect(selectSellerHomeAnalytics(null, 'seller_1', 'today')).toBeNull();
  });

  it('returns the snapshot only when its key matches the current seller and range exactly', () => {
    const data = { range: 'today', totalCents: 500, orderCount: 2, visitorCount: 10, toFulfill: 1, toCapture: 0, buckets: [] };
    const snapshot = { key: sellerHomeAnalyticsKey('seller_1', 'today'), data };
    expect(selectSellerHomeAnalytics(snapshot, 'seller_1', 'today')).toEqual(data);
    // Stale snapshot for a different range must not leak into the new range's view.
    expect(selectSellerHomeAnalytics(snapshot, 'seller_1', 'week')).toBeNull();
    // Stale snapshot for a different seller (e.g. after switching accounts) must not leak either.
    expect(selectSellerHomeAnalytics(snapshot, 'seller_2', 'today')).toBeNull();
  });
});
