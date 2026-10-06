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

  const refresh = useCallback(async () => {
    if (!live || !userId) { setOverview(null); return; }
    setLoading(true);
    try {
      const value = await api.aiCredits.get();
      cache = { userId, at: Date.now(), value };
      if (alive.current) setOverview(value);
    } catch {
      // Keep whatever was last known; the chip and note simply stay as they were.
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [api, live, userId]);

  useEffect(() => {
    if (!live) { setOverview(null); return; }
    if (cache?.userId === userId && Date.now() - cache.at < STALE_MS) { setOverview(cache.value); return; }
    void refresh();
  }, [live, userId, refresh]);

  return { overview, loading, refresh };
}
