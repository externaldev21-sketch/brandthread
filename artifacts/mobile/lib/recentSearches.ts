/**
 * Recent searches, persisted on the device so they survive restarts and work
 * signed-out. Signed-in buyers also keep the server-side history
 * (api.public.recent / log / removeRecent / clearRecent); `mergeRecent`
 * folds that in behind the local list so a reinstall still shows history.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const RECENT_SEARCHES_KEY = 'bt.search.recent.v1';
export const MAX_RECENT_SEARCHES = 20;

const norm = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase();

/** Newest first, case-insensitive de-dupe, capped. */
export function pushRecent(list: string[], term: string, max = MAX_RECENT_SEARCHES): string[] {
  const clean = term.trim().replace(/\s+/g, ' ');
  if (!clean) return list;
  return [clean, ...list.filter((t) => norm(t) !== norm(clean))].slice(0, max);
}

export function dropRecent(list: string[], term: string): string[] {
  return list.filter((t) => norm(t) !== norm(term));
}

/** Local entries first (they're the freshest on this device), then any server-only ones. */
export function mergeRecent(local: string[], server: string[], max = MAX_RECENT_SEARCHES): string[] {
  const seen = new Set(local.map(norm));
  return [...local, ...server.filter((t) => !seen.has(norm(t)) && seen.add(norm(t)))].slice(0, max);
}

export async function loadRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

async function save(list: string[]): Promise<string[]> {
  try { await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list)); } catch { /* best effort */ }
  return list;
}

export async function addRecentSearch(term: string): Promise<string[]> {
  return save(pushRecent(await loadRecentSearches(), term));
}

export async function removeRecentSearch(term: string): Promise<string[]> {
  return save(dropRecent(await loadRecentSearches(), term));
}

export async function clearRecentSearches(): Promise<void> {
  try { await AsyncStorage.removeItem(RECENT_SEARCHES_KEY); } catch { /* best effort */ }
}
