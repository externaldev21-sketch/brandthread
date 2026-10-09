/**
 * Shared TanStack Query client.
 *
 * Defaults are tuned so a screen the user already visited renders instantly
 * from cache (stale-while-revalidate) instead of re-showing a spinner, while
 * still picking up fresh data in the background. The client is persisted to
 * AsyncStorage so a cold app launch can paint the last-known data before the
 * network responds.
 */
import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Data is considered fresh for 30s (no refetch on remount/focus within that
// window) and kept around for 24h so a relaunch has something to paint
// immediately, even if it's stale and gets replaced moments later.
export const DEFAULT_STALE_TIME_MS = 30_000;
export const DEFAULT_GC_TIME_MS = 24 * 60 * 60_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: DEFAULT_STALE_TIME_MS,
      gcTime: DEFAULT_GC_TIME_MS,
      refetchOnWindowFocus: false,
      // Screens still get a background refresh when they refocus after the
      // data has gone stale — just not a duplicate refetch on every focus.
      refetchOnMount: true,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'bt:query-cache:v1',
  // Throttle writes so rapid cache updates (e.g. a scroll-triggered list of
  // queries resolving together) don't hammer AsyncStorage.
  throttleTime: 1_000,
});

// The signed-in Clerk userId every queryKeys.* entry below is scoped under
// (except `profile`, which already takes an explicit userId — left as-is).
// Set from app/_layout.tsx's ServiceConfigurer on sign-in/out/account switch,
// same moment as services/productService.ts's/cartService.ts's own per-user
// scoping. Namespacing (rather than queryClient.clear()ing on every switch)
// is what makes switching back to an already-visited account instant: its
// entries were never evicted, just filed under a key account B can't read.
let _queryScopeUserId = 'anon';
export function setQueryKeyScope(userId: string | null): void {
  _queryScopeUserId = userId ?? 'anon';
}

/** Query key helpers so prefetch (press-in) and the owning screen's useQuery
 *  always agree on the same cache entry. */
export const queryKeys = {
  product: (id: string) => ['product', _queryScopeUserId, id] as const,
  productList: (scope: string) => ['products', _queryScopeUserId, scope] as const,
  profile: (userId: string) => ['profile', userId] as const,
  order: (id: string) => ['order', _queryScopeUserId, id] as const,
  orderList: (scope: string) => ['orders', _queryScopeUserId, scope] as const,
  tabData: (tab: string) => ['tab-data', _queryScopeUserId, tab] as const,
  /** The buyer product page's public product row (api.publicProducts.get) —
   *  a different shape from `product` (the seller's own Product). */
  publicProduct: (id: string) => ['public-product', _queryScopeUserId, id] as const,
  /** The buyer order page's order row (loadBuyerOrder). */
  buyerOrder: (id: string) => ['buyer-order', _queryScopeUserId, id] as const,
};

/** How long a press-in prefetch (or a previous visit) counts as fresh enough
 *  to paint a detail page without refetching first. The page still renders
 *  from it instantly when older, and refreshes in the background. */
export const DETAIL_STALE_TIME_MS = 30_000;

/** For detail data the user can change (orders): reuse a press-in prefetch
 *  only if it finished moments ago, otherwise refetch (still painting the
 *  cached copy first). */
export const PRESS_IN_REUSE_MS = 5_000;
