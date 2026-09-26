/**
 * Instant-first-paint cache for the buyer Threads feed.
 *
 * Real TikTok never shows a gray skeleton over the feed — the first frame is
 * always either a real post (from cache) or nothing at all while the poster
 * loads, never a placeholder shape. To make that possible we keep the last
 * page of posts we successfully loaded for each tab ('for-you' | 'following')
 * both in memory (instant on a tab switch within the same session) and in
 * AsyncStorage (instant on a cold app start, before any network request has
 * even started).
 *
 * This is intentionally generic over the post shape (`T`) so it has no
 * dependency on `app/(tabs)/feed.tsx`'s locally-defined `SpotlightItem` type
 * and can be imported from there without a cycle.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_PREFIX = 'bt_feed_posts_cache_v1_';
// Only enough posts to paint the first screen or two instantly — this is a
// warm-start cache, not a full offline store, so it stays small on disk.
const MAX_CACHED_POSTS = 12;

const memoryCache = new Map<string, unknown[]>();

/** Synchronous — returns whatever is already in memory for this tab, or undefined. */
export function getCachedFeedPosts<T>(tab: string): T[] | undefined {
  return memoryCache.get(tab) as T[] | undefined;
}

/**
 * Reads AsyncStorage for this tab if nothing is in memory yet, and populates
 * the memory cache as a side effect so later calls in the same session are
 * synchronous. Resolves to undefined when there is nothing cached.
 */
export async function hydrateFeedPostsCache<T>(tab: string): Promise<T[] | undefined> {
  const inMemory = memoryCache.get(tab);
  if (inMemory) return inMemory as T[];
  try {
    const raw = await AsyncStorage.getItem(STORAGE_PREFIX + tab);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as T[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      memoryCache.set(tab, parsed);
      return parsed;
    }
  } catch {
    // Corrupt/unavailable cache — behave as if there were none.
  }
  return undefined;
}

/** Called after every successful feed load so the next cold start/tab switch is instant. */
export function setCachedFeedPosts<T>(tab: string, posts: T[]): void {
  if (!Array.isArray(posts) || posts.length === 0) return;
  memoryCache.set(tab, posts);
  const toPersist = posts.slice(0, MAX_CACHED_POSTS);
  AsyncStorage.setItem(STORAGE_PREFIX + tab, JSON.stringify(toPersist)).catch(() => {});
}
