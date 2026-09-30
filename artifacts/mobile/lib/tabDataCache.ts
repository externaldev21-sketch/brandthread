/**
 * Instant-first-paint cache for the buyer bottom tabs (Discover, Inbox,
 * Profile, Thread Cash), generalizing the pattern `feedPostsCache.ts`
 * already uses for the Feed tab: keep the last successful payload for a key
 * both in memory (instant on a same-session tab switch) and in AsyncStorage
 * (instant on a cold app start, before any network request resolves).
 *
 * Unlike `feedPostsCache.ts` this isn't array-shaped — a tab's cached value
 * is whatever JSON-serializable snapshot that screen needs to render without
 * a skeleton (e.g. an inbox's conversations + notifications together).
 *
 * Scoped by Clerk userId (same pattern as services/productService.ts /
 * cartService.ts) so two accounts signed in on one device never share a
 * tab's cached data. Switching to an account this cache has already seen
 * this session is instant — its entries were never cleared, just filed
 * under its own scope — so "switch back" doesn't refetch either.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_PREFIX = 'bt_tab_data_cache_v1_';

let _scopeUserId = 'anon';

/** Call on sign-in/sign-out/account switch, before any tab reads/writes this cache. */
export function initTabDataCache(userId: string | null): void {
  _scopeUserId = userId ?? 'anon';
}

function scopedKey(key: string): string {
  return `${_scopeUserId}:${key}`;
}

const memoryCache = new Map<string, unknown>();

/** Synchronous — returns whatever is already in memory for this key, or undefined. */
export function getCachedTabData<T>(key: string): T | undefined {
  return memoryCache.get(scopedKey(key)) as T | undefined;
}

/**
 * Reads AsyncStorage for this key if nothing is in memory yet, and populates
 * the memory cache as a side effect so later calls in the same session are
 * synchronous. Resolves to undefined when there is nothing cached.
 */
export async function hydrateTabData<T>(key: string): Promise<T | undefined> {
  const scoped = scopedKey(key);
  const inMemory = memoryCache.get(scoped);
  if (inMemory !== undefined) return inMemory as T;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_PREFIX + scoped);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as T;
    memoryCache.set(scoped, parsed);
    return parsed;
  } catch {
    // Corrupt/unavailable cache — behave as if there were none.
  }
  return undefined;
}

/** Called after every successful tab load so the next cold start/tab switch is instant. */
export function setCachedTabData<T>(key: string, data: T): void {
  if (data === undefined) return;
  const scoped = scopedKey(key);
  memoryCache.set(scoped, data);
  AsyncStorage.setItem(STORAGE_PREFIX + scoped, JSON.stringify(data)).catch(() => {});
}
