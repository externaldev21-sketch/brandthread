/**
 * Live co-host + purchase attribution, client side: the summary formatting,
 * the per-group live source sent with a cart checkout, the live Shop sheet
 * carrying the stream id, and the co-host invite deep links.
 */
import { describe, expect, it } from 'vitest';
import {
  formatConversion, formatCount, formatLiveDuration, purchaseLine,
} from '@/lib/live/liveAnalytics';
import { liveStreamIdForItems, paymentGroupsWithLive } from '@/lib/checkoutPayment';
import { liveShopSelection } from '@/lib/live/liveShop';
import { activityHref } from '@/lib/activity';

describe('live summary formatting', () => {
  it('formats duration, conversion, counts and the purchase line', () => {
    expect(formatLiveDuration(3880)).toBe('1h 04m');
    expect(formatLiveDuration(725)).toBe('12m 05s');
    expect(formatLiveDuration(45)).toBe('45s');
    expect(formatConversion(0.0257)).toBe('2.6%');
    expect(formatConversion(0.25)).toBe('25%');
    expect(formatConversion(null)).toBe('–');
    expect(formatCount(980)).toBe('980');
    expect(formatCount(1286)).toBe('1.3K');
    expect(formatCount(18420)).toBe('18K');
    expect(purchaseLine({ buyerFirstName: 'Jordan', productName: 'Wool Overshirt', units: 1 })).toBe('Jordan bought Wool Overshirt');
    expect(purchaseLine({ buyerFirstName: '', productName: 'Tee', units: 2 })).toBe('Someone bought 2 × Tee');
  });
});

describe('cart checkout carries the live source per seller group', () => {
  it('uses the first line added from a live', () => {
    expect(liveStreamIdForItems([{}, { sourceLiveStreamId: 's1' }, { sourceLiveStreamId: 's2' }])).toBe('s1');
    expect(liveStreamIdForItems([{}])).toBeUndefined();
    const groups = paymentGroupsWithLive({
      discounts: [],
      deliveryGroups: [
        { sellerId: 'a', items: [{ variantId: 'v1', productId: 'p1', quantity: 1, sourceLiveStreamId: 'live-1' }] },
        { sellerId: 'b', items: [{ variantId: 'v2', productId: 'p2', quantity: 2 }] },
      ],
    } as any);
    expect(groups[0]).toEqual({ items: [{ variantId: 'v1', productId: 'p1', quantity: 1 }], liveStreamId: 'live-1' });
    expect(groups[1]).toEqual({ items: [{ variantId: 'v2', productId: 'p2', quantity: 2 }] });
  });
});

describe('live Shop sheet selection', () => {
  const stream: any = {
    id: 'stream-1', title: 'Drop', host: { id: 'h', name: 'Host', handle: 'host' },
    products: [{ productId: 'p1', name: 'Tee', priceCents: 1000 }],
  };
  it('carries the stream id for real streams only', () => {
    expect(liveShopSelection(stream, 'p1', false)?.liveStreamId).toBe('stream-1');
    expect(liveShopSelection(stream, 'p1', true)?.liveStreamId).toBeUndefined();
  });
});

describe('co-host invite Activity row', () => {
  it('opens the accept / decline screen', () => {
    const row: any = { id: 'n', category: 'social', title: '', body: '', isRead: false, createdAt: '', type: 'live_cohost_invite', targetType: 'live_cohost', targetId: 'stream-3' };
    expect(activityHref(row)).toBe('/live-cohost-invite?streamId=stream-3');
  });
});
