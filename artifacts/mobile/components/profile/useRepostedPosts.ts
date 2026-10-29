import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { toTaggedItem, type TaggedItem } from '@/services/profileService';

/**
 * Public posts this profile reposted — the "Reposts" tab. Same row shape
 * (and tile/tap handling) as the Tagged tab. `enabled` false (signed out /
 * dev preview / not resolved yet) never calls the API.
 */
export function useRepostedPosts(userId: string | null | undefined, enabled: boolean) {
  const api = useApi();
  const [items, setItems] = useState<TaggedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // Bumped on every reload and profile switch: only the latest request may
  // write state, so a slow response for the previous profile never lands on
  // this one.
  const generationRef = useRef(0);

  const reload = useCallback(async () => {
    const generation = ++generationRef.current;
    if (!enabled || !userId) return;
    setLoading(true);
    setError(false);
    try {
      const rows = await api.social.reposts(userId);
      if (generation !== generationRef.current) return;
      setItems((Array.isArray(rows) ? rows : []).map(toTaggedItem).filter((item) => item.id));
    } catch {
      if (generation !== generationRef.current) return;
      setError(true);
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, [api, enabled, userId]);

  // A different profile (or disabled) never shows the previous one's rows.
  useEffect(() => {
    setItems([]);
    setError(false);
    setLoading(false);
  }, [userId, enabled]);

  useEffect(() => { void reload(); }, [reload]);

  return { items, loading, error, reload };
}
