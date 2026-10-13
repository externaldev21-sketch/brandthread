/**
 * Explicit sign-out cleanup for everything this device cached for an account.
 *
 * Account SWITCHING deliberately keeps each account's caches (they are
 * namespaced by userId, so switching back is instant — see app/_layout.tsx).
 * Signing OUT is different: the person is leaving, so their orders, inbox,
 * profile and feed must not stay on disk for the next person who picks up
 * the phone.
 */
import { queryClient } from './queryClient';
import { clearEngagementRetryQueue } from './engagementRetryQueue';
import { clearFeedPostsCacheForUser } from './feedPostsCache';
import { clearTabDataCacheForUser } from './tabDataCache';

/** True for a TanStack query key that belongs to `userId` (see queryKeys in lib/queryClient.ts). */
export function isUserScopedQueryKey(key: readonly unknown[], userId: string): boolean {
  return key.length > 1 && key[1] === userId;
}

export async function clearUserLocalData(userId: string): Promise<void> {
  if (!userId) return;
  queryClient.removeQueries({ predicate: (q) => isUserScopedQueryKey(q.queryKey, userId) });
  await Promise.all([
    clearFeedPostsCacheForUser(userId),
    clearTabDataCacheForUser(userId),
    clearEngagementRetryQueue(userId),
  ]);
}
