/**
 * Pure helpers for Sponsored ads in buyer feeds (no React, no network) —
 * used by hooks/useFeedAds.ts and components/ads/SponsoredAdCard.tsx.
 *
 * The server (GET /api/ads/serve) decides which ads run and where — one per 6
 * organic items, never first, frequency-capped per viewer. These helpers only
 * splice the served slots into the screen's organic list and turn a CTA
 * destination into an in-app route.
 */
import type { AdDestination, FeedAd } from '@/lib/api';

export type SponsoredFeedItem = {
  _isSponsoredAd: true;
  id: string;
  ad: FeedAd;
};

export function isSponsoredFeedItem(item: unknown): item is SponsoredFeedItem {
  return !!item && typeof item === 'object' && (item as SponsoredFeedItem)._isSponsoredAd === true;
}

export function toSponsoredItem(ad: FeedAd): SponsoredFeedItem {
  return { _isSponsoredAd: true, id: `sponsored-${ad.campaignId}-${ad.token.slice(0, 12)}`, ad };
}

/**
 * Converts a served page's page-local `afterIndex` values into absolute organic
 * indexes (the page started at `organicOffset`).
 */
export function absolutePlacements(ads: readonly FeedAd[], organicOffset: number): Array<[number, FeedAd]> {
  return ads.map((ad) => [organicOffset + ad.afterIndex, ad]);
}

/** Splices ads into the organic list after their absolute organic index. */
export function mergeFeedAds<T>(organic: readonly T[], placements: ReadonlyMap<number, FeedAd>): Array<T | SponsoredFeedItem> {
  if (placements.size === 0) return organic as Array<T | SponsoredFeedItem>;
  const out: Array<T | SponsoredFeedItem> = [];
  organic.forEach((item, i) => {
    out.push(item);
    const ad = placements.get(i);
    if (ad) out.push(toSponsoredItem(ad));
  });
  return out;
}

/** Where the CTA opens inside the app. */
export function adDestinationHref(destination: AdDestination, ad?: Pick<FeedAd, 'seller'>): string {
  switch (destination.kind) {
    case 'product':
      return `/buyer-product-detail?productId=${encodeURIComponent(destination.productId)}`;
    case 'contact': {
      const params = new URLSearchParams({ participantId: destination.sellerId, participantAccountType: 'seller' });
      if (ad?.seller.displayName) params.set('participantName', ad.seller.displayName);
      if (ad?.seller.username) params.set('participantHandle', ad.seller.username);
      return `/buyer-conversation?${params.toString()}`;
    }
    case 'profile':
    case 'store':
    default:
      return `/seller-profile?id=${encodeURIComponent(destination.sellerId)}&src=feed`;
  }
}

/** Random, URL-safe id (8–64 chars of [A-Za-z0-9_-]) for one app session. */
export function newAdSessionId(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  let id = '';
  for (let i = 0; i < 24; i += 1) id += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  return id;
}

/** Minimum share of the card on screen for a viewable impression. */
export const AD_VIEWABLE_FRACTION = 0.5;
/** How long it must stay viewable before the impression is confirmed. */
export const AD_VIEWABLE_MS = 1000;

/** Fraction (0..1) of a measured box inside the viewport. */
export function visibleFraction(
  box: { y: number; height: number; x?: number; width?: number },
  viewport: { height: number; width?: number },
): number {
  if (box.height <= 0) return 0;
  const top = Math.max(0, box.y);
  const bottom = Math.min(viewport.height, box.y + box.height);
  let fraction = Math.max(0, bottom - top) / box.height;
  if (box.width && viewport.width && box.x !== undefined) {
    const left = Math.max(0, box.x);
    const right = Math.min(viewport.width, box.x + box.width);
    fraction *= Math.max(0, right - left) / box.width;
  }
  return fraction;
}

/**
 * For grid feeds that pack organic items into rows (Discover): each ad in a
 * merged list, keyed by the id of the organic item it follows.
 */
export function sponsoredAnchors<T>(
  merged: ReadonlyArray<T | SponsoredFeedItem>,
  getId: (item: T) => string,
): Array<{ afterId: string; item: SponsoredFeedItem }> {
  const anchors: Array<{ afterId: string; item: SponsoredFeedItem }> = [];
  let lastId: string | null = null;
  for (const entry of merged) {
    if (isSponsoredFeedItem(entry)) {
      if (lastId) anchors.push({ afterId: lastId, item: entry });
    } else {
      lastId = getId(entry as T);
    }
  }
  return anchors;
}
