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
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_PREFIX = 'bt_tab_data_cache_v1_';

const memoryCache = new Map<string, unknown>();

/** Synchronous — returns whatever is already in memory for this key, or undefined. */
export function getCachedTabData<T>(key: string): T | undefined {
  return memoryCache.get(key) as T | undefined;
}

/**
 * Reads AsyncStorage for this key if nothing is in memory yet, and populates
 * the memory cache as a side effect so later calls in the same session are
 * synchronous. Resolves to undefined when there is nothing cached.
 */
export async function hydrateTabData<T>(key: string): Promise<T | undefined> {
  const inMemory = memoryCache.get(key);
  if (inMemory !== undefined) return inMemory as T;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as T;
    memoryCache.set(key, parsed);
    return parsed;
  } catch {
    // Corrupt/unavailable cache — behave as if there were none.
  }
  return undefined;
}

/** Called after every successful tab load so the next cold start/tab switch is instant. */
export function setCachedTabData<T>(key: string, data: T): void {
  if (data === undefined) return;
  memoryCache.set(key, data);
  AsyncStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data)).catch(() => {});
}
