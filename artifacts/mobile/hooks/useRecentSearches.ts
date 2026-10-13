/**
 * Recent searches for the Discover search overlay.
 *
 * Signed in: the server's per-user history (search_log via
 * api.public.recent / log / removeRecent / clearRecent), updated
 * optimistically. Signed out: kept on this device only (AsyncStorage) so a
 * guest still sees their own recents and no protected endpoint is called.
 * Either way the list is deduped case-insensitively and capped at 10.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import { RECENT_CAP, dedupeRecent, mergeRecent, removeRecent } from '@/lib/discoverSearch';

const GUEST_KEY = 'bt.discoverSearch.recent.v1';

async function readGuest(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(GUEST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? dedupeRecent(parsed.filter((t): t is string => typeof t === 'string')) : [];
  } catch {
    return [];
  }
}

function writeGuest(list: string[]) {
  AsyncStorage.setItem(GUEST_KEY, JSON.stringify(list)).catch(() => {});
}

export function useRecentSearches() {
  const api = useApi();
  const { isSignedIn } = useAuth();
  const [recent, setRecent] = useState<string[]>([]);

  const reload = useCallback(async () => {
    if (isSignedIn) {
      try {
        const { recent: rows } = await api.public.recent(RECENT_CAP);
        setRecent(dedupeRecent(rows.map((r) => r.query)));
      } catch {
        // Keep whatever is on screen.
      }
    } else {
      setRecent(await readGuest());
    }
  }, [api, isSignedIn]);

  useEffect(() => { reload(); }, [reload]);

  const add = useCallback((term: string) => {
    if (!term.trim()) return;
    setRecent((cur) => {
      const next = mergeRecent(cur, term);
      if (!isSignedIn) writeGuest(next);
      return next;
    });
    // Public endpoint (optional viewer): signed in it lands in this user's
    // history, signed out it only feeds the anonymous trending counts.
    api.public.log(term.trim()).catch(() => {});
  }, [api, isSignedIn]);

  const remove = useCallback((term: string) => {
    setRecent((cur) => {
      const next = removeRecent(cur, term);
      if (!isSignedIn) writeGuest(next);
      return next;
    });
    if (isSignedIn) api.public.removeRecent(term).catch(() => {});
  }, [api, isSignedIn]);

  const clear = useCallback(() => {
    setRecent([]);
    if (isSignedIn) api.public.clearRecent().catch(() => {});
    else writeGuest([]);
  }, [api, isSignedIn]);

  return { recent, add, remove, clear, reload };
}
