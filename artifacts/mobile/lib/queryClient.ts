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

/** Query key helpers so prefetch (press-in) and the owning screen's useQuery
 *  always agree on the same cache entry. */
export const queryKeys = {
  product: (id: string) => ['product', id] as const,
  productList: (scope: string) => ['products', scope] as const,
  profile: (userId: string) => ['profile', userId] as const,
  order: (id: string) => ['order', id] as const,
  orderList: (scope: string) => ['orders', scope] as const,
  tabData: (tab: string) => ['tab-data', tab] as const,
};
