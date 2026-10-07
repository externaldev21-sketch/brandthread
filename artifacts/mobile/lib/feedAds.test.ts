import { describe, expect, it } from 'vitest';
import type { FeedAd } from '@/lib/api';
import {
  absolutePlacements, adDestinationHref, isSponsoredFeedItem, mergeFeedAds, newAdSessionId, sponsoredAnchors, visibleFraction,
} from './feedAds';

function ad(over: Partial<FeedAd> = {}): FeedAd {
  return {
    afterIndex: 5, token: 'tok_abcdefghijklmnop', campaignId: 'c1', surface: 'for_you', label: 'Sponsored',
    headline: 'Fall drop', description: null, mediaKind: 'photos', mediaUrls: ['https://cdn.test/a.jpg'],
    ctaKind: 'shop_now', ctaLabel: 'Shop now',
    destination: { kind: 'product', productId: 'p1', sellerId: 's1' },
    seller: { id: 's1', displayName: 'North Fleece', username: 'northfleece', avatarUrl: null },
    product: null,
    ...over,
  };
}

describe('feed ads placement', () => {
  it('converts page-local slots to absolute organic indexes and splices them in', () => {
    const placements = new Map(absolutePlacements([ad({ afterIndex: 5 })], 6));
    expect([...placements.keys()]).toEqual([11]);
    const organic = Array.from({ length: 13 }, (_, i) => ({ id: `p${i}` }));
    const merged = mergeFeedAds(organic, placements);
    expect(merged).toHaveLength(14);
    expect(isSponsoredFeedItem(merged[12])).toBe(true);
    expect((merged[11] as { id: string }).id).toBe('p11');
    expect(isSponsoredFeedItem(merged[0])).toBe(false);
  });

  it('returns the organic list untouched when there are no ads', () => {
    const organic = [{ id: 'a' }];
    expect(mergeFeedAds(organic, new Map())).toBe(organic);
  });

  it('anchors ads to the organic item they follow (grid feeds)', () => {
    const merged = mergeFeedAds([{ id: 'a' }, { id: 'b' }], new Map([[1, ad()]]));
    const anchors = sponsoredAnchors(merged, (p) => p.id);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].afterId).toBe('b');
  });
});

describe('CTA destinations', () => {
  it('maps destinations to in-app routes', () => {
    expect(adDestinationHref({ kind: 'product', productId: 'p 1', sellerId: 's' })).toBe('/buyer-product-detail?productId=p%201');
    expect(adDestinationHref({ kind: 'store', sellerId: 's1' })).toBe('/seller-profile?id=s1&src=feed');
    expect(adDestinationHref({ kind: 'profile', sellerId: 's1' })).toBe('/seller-profile?id=s1&src=feed');
    const contact = adDestinationHref({ kind: 'contact', sellerId: 's1' }, ad());
    expect(contact.startsWith('/buyer-conversation?')).toBe(true);
    expect(contact).toContain('participantId=s1');
    expect(contact).toContain('participantName=North+Fleece');
  });
});

describe('viewability + session id', () => {
  it('computes the visible fraction of a box in the viewport', () => {
    expect(visibleFraction({ y: 0, height: 100 }, { height: 844 })).toBe(1);
    expect(visibleFraction({ y: 794, height: 100 }, { height: 844 })).toBe(0.5);
    expect(visibleFraction({ y: 900, height: 100 }, { height: 844 })).toBe(0);
    expect(visibleFraction({ y: -844, height: 844 }, { height: 844 })).toBe(0);
    expect(visibleFraction({ y: 0, height: 0 }, { height: 844 })).toBe(0);
  });

  it('makes a server-valid session id', () => {
    expect(newAdSessionId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});
