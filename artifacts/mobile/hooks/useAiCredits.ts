import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import type { AiCreditsOverview } from '@/lib/aiCredits';

const STALE_MS = 15_000;
let cache: { userId: string; at: number; value: AiCreditsOverview } | null = null;

/** Drop the cached balance, e.g. after a generation finished or a pack was bought. */
export function invalidateAiCredits(): void {
  cache = null;
}

/**
 * Current AI credit overview for the signed-in user.
 * Signed out: never calls the API and returns `overview: null`.
 * Pro: `overview.unlimited` is true and callers render nothing balance-related.
 */
export function useAiCredits(): { overview: AiCreditsOverview | null; loading: boolean; refresh: () => Promise<void> } {
  const { isSignedIn, userId } = useAuth();
  const api = useApi();
  const live = !!isSignedIn && !!userId;
  const [overview, setOverview] = useState<AiCreditsOverview | null>(() => (live && cache?.userId === userId ? cache.value : null));
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // The account this hook is showing now: a slower answer for an account
  // the device has since switched away from must not land on screen.
  const currentUser = useRef<string | null>(null);
  currentUser.current = live ? userId ?? null : null;
  // Whose balance `overview` holds.
  const shownFor = useRef<string | null>(live && cache?.userId === userId ? userId ?? null : null);

  const refresh = useCallback(async () => {
    if (!live || !userId) { shownFor.current = null; setOverview(null); return; }
    setLoading(true);
    try {
      const value = await api.aiCredits.get();
      cache = { userId, at: Date.now(), value };
      if (alive.current && currentUser.current === userId) { shownFor.current = userId; setOverview(value); }
    } catch {
      // Keep whatever was last known; the chip and note simply stay as they were.
    } finally {
      if (alive.current && currentUser.current === userId) setLoading(false);
    }
  }, [api, live, userId]);

  useEffect(() => {
    if (!live) { shownFor.current = null; setOverview(null); return; }
    if (cache?.userId === userId && Date.now() - cache.at < STALE_MS) { shownFor.current = userId; setOverview(cache.value); return; }
    // Another account's balance (from before a switch) never stays up while this one loads.
    if (shownFor.current !== userId) { shownFor.current = null; setOverview(null); }
    void refresh();
  }, [live, userId, refresh]);

  return { overview, loading, refresh };
}
