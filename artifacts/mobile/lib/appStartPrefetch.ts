/**
 * App-start / idle warmup for the buyer bottom tabs.
 *
 * Fires once, after the first interaction frame (so it never competes with
 * the boot screen or the first paint), and kicks off every main tab's first
 * page of data in parallel: Feed, Discover, Inbox, Profile and Thread Cash.
 *
 * Two things make this actually pay off by the time the user taps a tab:
 *  - `lib/api.ts`'s request layer dedupes identical in-flight GETs, so a
 *    screen's own fetch on mount joins this same network call instead of
 *    firing a second one, as long as the tab is opened while it's still
 *    in flight.
 *  - Results land in `feedPostsCache` / `tabDataCache`, so a screen that
 *    reads from there on mount (see `app/(tabs)/feed.tsx`,
 *    `app/(buyer)/inbox.tsx`) paints real content on the very first frame
 *    instead of a skeleton, even on a cold start.
 *
 * Also registers each fetch with the shared React Query client so it is
 * covered by the app's persisted query cache (`lib/queryClient.ts`) and
 * visible to the dev perf overlay.
 */
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryClient';
import { prefetchImage } from '@/lib/prefetch';
import { setCachedFeedPosts } from '@/lib/feedPostsCache';
import { setCachedTabData } from '@/lib/tabDataCache';
import { getConversations, getNotifications, getThreadPostsPage, createThreadFeedCursor } from '@/services/socialService';
import type { BrandthreadApi } from '@/lib/api';

const NEXT_POSTER_PREFETCH_COUNT = 3;

function posterUriOf(post: unknown): string | null {
  const p = post as { thumbnailUrl?: string; posterUrl?: string; imageUri?: string } | null;
  return p?.thumbnailUrl ?? p?.posterUrl ?? p?.imageUri ?? null;
}

async function warmFeed(queryClient: QueryClient): Promise<void> {
  const page = await queryClient.fetchQuery({
    queryKey: queryKeys.tabData('feed:for-you'),
    queryFn: () => getThreadPostsPage(createThreadFeedCursor(), 20, 'for-you'),
  });
  const posts = Array.isArray(page?.posts) ? page.posts : [];
  if (posts.length > 0) setCachedFeedPosts('for-you', posts);
  posts.slice(0, NEXT_POSTER_PREFETCH_COUNT).forEach((post) => prefetchImage(posterUriOf(post)));
}

async function warmDiscover(queryClient: QueryClient, api: BrandthreadApi): Promise<void> {
  const [highDemand, forYou, trending] = await queryClient.fetchQuery({
    queryKey: queryKeys.tabData('discover'),
    queryFn: () => Promise.all([
      api.publicProducts.highDemand(6),
      api.publicProducts.list({ limit: 8 }),
      api.publicTrending.get(20),
    ]),
  });
  setCachedTabData('discover', { highDemand, forYou, trending });
  ([...(highDemand ?? []), ...(forYou ?? [])] as Array<{ imageUri?: string; cutoutUri?: string }>)
    .slice(0, 8)
    .forEach((item) => prefetchImage(item.cutoutUri ?? item.imageUri));
}

async function warmInbox(queryClient: QueryClient): Promise<void> {
  const [conversations, notifications] = await queryClient.fetchQuery({
    queryKey: queryKeys.tabData('inbox'),
    queryFn: () => Promise.all([getConversations(), getNotifications()]),
  });
  setCachedTabData('inbox', { conversations, notifications });
}

async function warmProfile(queryClient: QueryClient, userId: string): Promise<void> {
  const profile = await queryClient.fetchQuery({
    queryKey: queryKeys.profile(userId),
    queryFn: async () => {
      const mod = await import('@/lib/buyerProfile');
      return mod.loadBuyerProfile();
    },
  });
  setCachedTabData('profile', profile);
}

async function warmThreadCash(queryClient: QueryClient, api: BrandthreadApi): Promise<void> {
  const status = await queryClient.fetchQuery({
    queryKey: queryKeys.tabData('thread-cash'),
    queryFn: () => api.threadCash.get(),
  });
  setCachedTabData('threadCash', status);
}

/**
 * Kick off every main tab's first page of data. Every warmer is independent
 * and swallows its own errors — a slow/broken Thread Cash endpoint should
 * never hold up Discover or Inbox, and a failure here is invisible to the
 * user (their own screen fetch, on mount, is the real error path).
 */
export function warmBuyerTabs(queryClient: QueryClient, api: BrandthreadApi, userId: string | null): void {
  void warmFeed(queryClient).catch(() => {});
  void warmDiscover(queryClient, api).catch(() => {});
  void warmInbox(queryClient).catch(() => {});
  void warmThreadCash(queryClient, api).catch(() => {});
  if (userId) void warmProfile(queryClient, userId).catch(() => {});
}
