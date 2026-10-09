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
 *
 * Scoped by Clerk userId (same pattern as tabDataCache.ts /
 * services/productService.ts) — different accounts follow different people,
 * so a "For You"/"Following" page cached for one account must never paint
 * on another's feed after a switch.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_PREFIX = 'bt_feed_posts_cache_v1_';
// Only enough posts to paint the first screen or two instantly — this is a
// warm-start cache, not a full offline store, so it stays small on disk.
const MAX_CACHED_POSTS = 12;

let _scopeUserId = 'anon';

/** Call on sign-in/sign-out/account switch, before any screen reads/writes this cache. */
export function initFeedPostsCache(userId: string | null): void {
  _scopeUserId = userId ?? 'anon';
}

function scopedTab(tab: string): string {
  return `${_scopeUserId}:${tab}`;
}

const memoryCache = new Map<string, unknown[]>();

/**
 * Bumped on every follow, unfollow, block or unblock. The feed compares it on
 * refocus so the Following tab picks up a newly followed account's posts as
 * soon as the viewer comes back, without resetting the feed on the tap itself.
 */
let followGraphVersion = 0;

export function noteFollowGraphChanged(): void {
  followGraphVersion += 1;
}

export function getFollowGraphVersion(): number {
  return followGraphVersion;
}

/** Synchronous — returns whatever is already in memory for this tab, or undefined. */
export function getCachedFeedPosts<T>(tab: string): T[] | undefined {
  return memoryCache.get(scopedTab(tab)) as T[] | undefined;
}

/**
 * Reads AsyncStorage for this tab if nothing is in memory yet, and populates
 * the memory cache as a side effect so later calls in the same session are
 * synchronous. Resolves to undefined when there is nothing cached.
 */
export async function hydrateFeedPostsCache<T>(tab: string): Promise<T[] | undefined> {
  const scoped = scopedTab(tab);
  const inMemory = memoryCache.get(scoped);
  if (inMemory) return inMemory as T[];
  try {
    const raw = await AsyncStorage.getItem(STORAGE_PREFIX + scoped);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as T[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      memoryCache.set(scoped, parsed);
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
  const scoped = scopedTab(tab);
  memoryCache.set(scoped, posts);
  const toPersist = posts.slice(0, MAX_CACHED_POSTS);
  AsyncStorage.setItem(STORAGE_PREFIX + scoped, JSON.stringify(toPersist)).catch(() => {});
}

/**
 * Blocking someone must remove their posts from the warm-start feed caches
 * right away (memory and AsyncStorage, every tab for the current account), so a
 * cold start or tab switch can never paint a blocked person's post before the
 * network responds. Posts carry the author in `sellerId`.
 */
export async function purgeAuthorFromFeedPostsCache(authorId: string): Promise<void> {
  if (!authorId) return;
  const prefix = `${_scopeUserId}:`;
  const tabs = new Set<string>(['for-you', 'following']);
  for (const key of memoryCache.keys()) if (key.startsWith(prefix)) tabs.add(key.slice(prefix.length));
  await Promise.all([...tabs].map(async (tab) => {
    const posts = await hydrateFeedPostsCache<{ sellerId?: string }>(tab);
    if (!posts) return;
    const filtered = posts.filter((post) => post?.sellerId !== authorId);
    if (filtered.length === posts.length) return;
    memoryCache.set(scopedTab(tab), filtered);
    try {
      await AsyncStorage.setItem(STORAGE_PREFIX + scopedTab(tab), JSON.stringify(filtered.slice(0, MAX_CACHED_POSTS)));
    } catch {
      // The memory copy is already clean; the next feed load rewrites the disk copy.
    }
  }));
}
