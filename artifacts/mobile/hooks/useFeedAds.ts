/**
 * useFeedAds — Sponsored ads for one buyer feed (Following, For You or
 * Discover). The one shared hook every feed uses:
 *
 *   const ads = useFeedAds({ surface: 'for_you', organic: items, enabled });
 *   <FlatList data={ads.items} … />  // organic items with ads spliced in
 *   isSponsoredFeedItem(item) → <SponsoredAdCard ad={item.ad} onViewable={ads.confirmImpression} onPress={ads.openAd} />
 *
 * - Fetches slots from GET /api/ads/serve as organic pages arrive (the server
 *   owns placement: 1 ad per 6 organic items, never first; caps; pacing).
 * - Confirms each viewable impression once (the card reports >=50% visible for
 *   ~1s) via POST /api/ads/impression.
 * - On tap records the click (POST /api/ads/click) and opens the CTA target.
 *
 * Signed-out (and any `enabled: false` caller) never calls the API — ads are
 * a signed-in-only feature, and a failure simply means no ads.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import type { AdSurface, FeedAd } from '@/lib/api';
import {
  absolutePlacements, adDestinationHref, mergeFeedAds, newAdSessionId,
  type SponsoredFeedItem,
} from '@/lib/feedAds';

/** One id per app launch: the server never repeats a campaign within it. */
const APP_AD_SESSION_ID = newAdSessionId();
/** Upper bound on organic items sent per serve request (server accepts <= 60). */
const MAX_PAGE = 60;

export type UseFeedAdsResult<T> = {
  items: Array<T | SponsoredFeedItem>;
  confirmImpression: (ad: FeedAd) => void;
  openAd: (ad: FeedAd) => void;
};

export function useFeedAds<T>({
  surface,
  organic,
  enabled = true,
  resetKey,
}: {
  surface: AdSurface;
  organic: readonly T[];
  enabled?: boolean;
  /** Changing this (e.g. a tab switch or pull-to-refresh generation) clears placed ads. */
  resetKey?: string | number;
}): UseFeedAdsResult<T> {
  const api = useApi();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const active = enabled && isSignedIn === true;

  const [placements, setPlacements] = useState<ReadonlyMap<number, FeedAd>>(() => new Map());
  const servedUpTo = useRef(0);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const confirmed = useRef(new Set<string>());
  const [tick, setTick] = useState(0);

  // Reset on surface/tab change, or when the organic list shrinks (refresh).
  const resetSignature = `${surface}::${resetKey ?? ''}`;
  const lastSignature = useRef(resetSignature);
  if (lastSignature.current !== resetSignature || organic.length < servedUpTo.current) {
    lastSignature.current = resetSignature;
    servedUpTo.current = 0;
    generation.current += 1;
    inFlight.current = false;
    if (placements.size > 0) setPlacements(new Map());
  }

  useEffect(() => {
    if (!active || inFlight.current) return;
    const offset = servedUpTo.current;
    const count = Math.min(organic.length - offset, MAX_PAGE);
    if (count <= 0) return;
    inFlight.current = true;
    const gen = generation.current;
    api.ads.serve({ surface, sessionId: APP_AD_SESSION_ID, organicOffset: offset, organicCount: count })
      .then((res) => {
        if (gen !== generation.current) return;
        const ads = Array.isArray(res?.ads) ? res.ads : [];
        if (ads.length > 0) {
          setPlacements((prev) => {
            const next = new Map(prev);
            for (const [index, ad] of absolutePlacements(ads, offset)) next.set(index, ad);
            return next;
          });
        }
        servedUpTo.current = offset + count;
      })
      .catch(() => {
        // Ads are optional — never retry-loop or surface an error in the feed.
        if (gen === generation.current) servedUpTo.current = offset + count;
      })
      .finally(() => {
        if (gen !== generation.current) return;
        inFlight.current = false;
        setTick((n) => n + 1); // re-check: more organic items may have arrived meanwhile
      });
  }, [active, api, surface, organic.length, tick, resetSignature]);

  const items = useMemo(
    () => (active ? mergeFeedAds(organic, placements) : (organic as Array<T | SponsoredFeedItem>)),
    [active, organic, placements],
  );

  const confirmImpression = useCallback((ad: FeedAd) => {
    if (!active || confirmed.current.has(ad.token)) return;
    confirmed.current.add(ad.token);
    api.ads.impression(ad.token).catch(() => {
      confirmed.current.delete(ad.token);
    });
  }, [active, api]);

  const openAd = useCallback((ad: FeedAd) => {
    // Navigate immediately with the served destination; the click call
    // records the tap (and confirms the impression server-side if needed).
    router.push(adDestinationHref(ad.destination, ad) as never);
    if (active) api.ads.click(ad.token).catch(() => {});
  }, [active, api, router]);

  return { items, confirmImpression, openAd };
}
