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
import { cacheStamp } from './cacheVersion';

// Keys are `<prefix><cache stamp>:<userId>:<key>` so a payload written by an
// older build is never read back (lib/cacheVersion.ts).
export const TAB_DATA_CACHE_PREFIX = 'bt_tab_data_cache_v1_';
const STORAGE_PREFIX = `${TAB_DATA_CACHE_PREFIX}${cacheStamp()}:`;

let _scopeUserId = 'anon';

/** Call on sign-in/sign-out/account switch, before any tab reads/writes this cache. */
export function initTabDataCache(userId: string | null): void {
  _scopeUserId = userId ?? 'anon';
}

function scopedKey(key: string): string {
  return `${_scopeUserId}:${key}`;
}

const memoryCache = new Map<string, unknown>();
/** Bumped by every write/clear of a key, so a disk read that started earlier never lands over it. */
const keyVersion = new Map<string, number>();
const bump = (scoped: string) => keyVersion.set(scoped, (keyVersion.get(scoped) ?? 0) + 1);
let clears = 0;

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
  const version = keyVersion.get(scoped) ?? 0;
  const clearsAtStart = clears;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_PREFIX + scoped);
    // A fresh load (or a sign-out clear) happened while the disk read was in
    // flight: what it read is older, so keep what memory holds now.
    if ((keyVersion.get(scoped) ?? 0) !== version || clears !== clearsAtStart) {
      return memoryCache.get(scoped) as T | undefined;
    }
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as T;
    memoryCache.set(scoped, parsed);
    return parsed;
  } catch {
    // Corrupt/unavailable cache — behave as if there were none.
  }
  return undefined;
}

/** Memory-only write — instant on the next mount this session, never persisted. */
export function setMemoryTabData<T>(key: string, data: T): void {
  if (data === undefined) return;
  const scoped = scopedKey(key);
  bump(scoped);
  memoryCache.set(scoped, data);
}

/**
 * Keys written with `persist: true` (lib/stickyState.ts) or by the app-start
 * warmers that a cold start should paint from. Hydrated into memory once per
 * account by `hydratePersistedTabData()` so the screens' synchronous
 * `getCachedTabData` reads see them on their very first frame.
 */
export const PERSISTED_TAB_KEYS = [
  'inbox',
  'inbox:storyTray',
  'inbox:myStoryId',
  'inbox:myNote',
  'inbox:notesByAuthor',
  'inbox:suggested',
  'discover:forYouFeed',
  'discover:justDropped',
  'discover:highDemand',
  'discover:people',
  'discover:brands',
  'discover:featured',
  'discover:recommendedBrands',
  'discovery:categories',
  'discovery:trendingProducts',
  'discovery:trendingBrands',
] as const;

export async function hydratePersistedTabData(): Promise<void> {
  await Promise.all(PERSISTED_TAB_KEYS.map((key) => hydrateTabData(key)));
}

/** Called after every successful tab load so the next cold start/tab switch is instant. */
export function setCachedTabData<T>(key: string, data: T): void {
  if (data === undefined) return;
  const scoped = scopedKey(key);
  bump(scoped);
  memoryCache.set(scoped, data);
  AsyncStorage.setItem(STORAGE_PREFIX + scoped, JSON.stringify(data)).catch(() => {});
}

/** Explicit sign-out: forget this account's cached tab snapshots (memory + disk). */
export async function clearTabDataCacheForUser(userId: string): Promise<void> {
  const prefix = `${userId}:`;
  for (const key of [...memoryCache.keys()]) if (key.startsWith(prefix)) memoryCache.delete(key);
  // Also invalidates disk reads still in flight (they may not be in memory
  // yet), so none of them repopulates what was just cleared.
  clears += 1;
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(STORAGE_PREFIX + prefix));
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);
  } catch {
    // Best-effort.
  }
}
