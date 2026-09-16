import { describe, expect, it } from 'vitest';

import {
  selectSellerHomeAnalytics,
  sellerHomeAnalyticsKey,
  zeroSellerHomeAnalytics,
  type SellerHomeAnalyticsSnapshot,
} from './sellerHomeAnalytics';

describe('seller home analytics zero state', () => {
  it('provides honest zero values when a seller has no sales yet', () => {
    expect(zeroSellerHomeAnalytics('today')).toEqual({
      range: 'today',
      totalCents: 0,
      orderCount: 0,
      visitorCount: 0,
      toFulfill: 0,
      toCapture: 0,
      buckets: [],
    });
  });

  it('never exposes a previous seller or time range snapshot', () => {
    const snapshot: SellerHomeAnalyticsSnapshot = {
      key: sellerHomeAnalyticsKey('seller-a', 'today'),
      data: {
        ...zeroSellerHomeAnalytics('today'),
        totalCents: 12_500,
        orderCount: 3,
      },
    };

    expect(selectSellerHomeAnalytics(snapshot, 'seller-a', 'today')).toEqual(snapshot.data);
    expect(selectSellerHomeAnalytics(snapshot, 'seller-b', 'today')).toBeNull();
    expect(selectSellerHomeAnalytics(snapshot, 'seller-a', 'week')).toBeNull();
  });

  it('uses zeros without exposing a stored snapshot while no seller is authenticated', () => {
    const snapshot: SellerHomeAnalyticsSnapshot = {
      key: sellerHomeAnalyticsKey('seller-a', 'today'),
      data: { ...zeroSellerHomeAnalytics('today'), totalCents: 12_500 },
    };

    expect(selectSellerHomeAnalytics(snapshot, null, 'week')).toEqual(zeroSellerHomeAnalytics('week'));
  });
});