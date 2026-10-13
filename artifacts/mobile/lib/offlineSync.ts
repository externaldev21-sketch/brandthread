/**
 * App-wide offline plumbing, started once from app/_layout.tsx.
 *
 * - TanStack Query's onlineManager follows the app's own connectivity flag
 *   (hooks/useIsOffline.ts), so queries/mutations pause while offline and
 *   resume by themselves the moment the connection is back — no spinner
 *   left hanging, no failed refetch replacing cached data.
 * - Queued offline likes/follows/saves (lib/engagementRetryQueue.ts) replay
 *   right when the connection comes back, not on the next 20s tick.
 * - Caches written by an older build are swept off disk (lib/cacheVersion.ts).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager } from '@tanstack/react-query';
import { subscribeConnectivity } from '@/hooks/useIsOffline';
import { cacheStamp, staleCacheKeys } from './cacheVersion';
import { processEngagementRetryQueue } from './engagementRetryQueue';
import { FEED_POSTS_CACHE_PREFIX } from './feedPostsCache';
import { TAB_DATA_CACHE_PREFIX } from './tabDataCache';

const LEGACY_ENGAGEMENT_QUEUE_KEY = 'bt:engagement-retry-queue:v1';

let started = false;

export function startOfflineSync(): void {
  if (started) return;
  started = true;

  onlineManager.setEventListener((setOnline) =>
    subscribeConnectivity((isOffline) => {
      setOnline(!isOffline);
      if (!isOffline) void processEngagementRetryQueue();
    }),
  );

  void sweepStaleCaches();
}

async function sweepStaleCaches(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const stale = staleCacheKeys(keys, [FEED_POSTS_CACHE_PREFIX, TAB_DATA_CACHE_PREFIX], cacheStamp());
    // The engagement queue used to live under one unscoped key; it is now
    // per account (lib/engagementRetryQueue.ts), so the old one is dropped.
    if (keys.includes(LEGACY_ENGAGEMENT_QUEUE_KEY)) stale.push(LEGACY_ENGAGEMENT_QUEUE_KEY);
    if (stale.length > 0) await AsyncStorage.multiRemove(stale);
  } catch {
    // Best-effort: stale keys are never read back anyway.
  }
}
