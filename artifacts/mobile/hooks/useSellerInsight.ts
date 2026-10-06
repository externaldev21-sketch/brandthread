import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/expo';
import { previewMode } from '@/services/sellerInsightsService';

/** Loads one insight; never calls the API without a signed-in user (preview uses local data). */
export function useSellerInsight<T>(load: () => Promise<T>, deps: unknown[]) {
  const { isLoaded, userId } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const gen = useRef(0);
  const run = useCallback(async () => {
    const g = ++gen.current;
    if (!previewMode() && (!isLoaded || !userId)) return;
    setLoading(true);
    try {
      const next = await load();
      if (g !== gen.current) return;
      setData(next); setError(false);
    } catch {
      if (g !== gen.current) return;
      setError(true);
    } finally {
      if (g === gen.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, userId, ...deps]);
  useEffect(() => { void run(); }, [run]);
  return { data, loading, error, reload: run, setData };
}
