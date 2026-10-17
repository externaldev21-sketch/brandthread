import { useCallback, useEffect, useState } from 'react';
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

  const reload = useCallback(async () => {
    if (!enabled || !userId) return;
    setLoading(true);
    setError(false);
    try {
      const rows = await api.social.reposts(userId);
      setItems((Array.isArray(rows) ? rows : []).map(toTaggedItem).filter((item) => item.id));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [api, enabled, userId]);

  useEffect(() => { void reload(); }, [reload]);

  return { items, loading, error, reload };
}
