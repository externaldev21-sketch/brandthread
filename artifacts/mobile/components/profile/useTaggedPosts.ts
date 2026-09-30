import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { toTaggedItem, type TaggedItem } from '@/services/profileService';

/**
 * Posts (and, later, stories) where someone tagged this profile — the
 * "Tagged" tab. `enabled` false (signed out / dev preview / not resolved yet)
 * never calls the API, so the signed-out preview stays off protected routes.
 */
export function useTaggedPosts(userId: string | null | undefined, enabled: boolean) {
  const api = useApi();
  const [items, setItems] = useState<TaggedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled || !userId) return;
    setLoading(true);
    setError(false);
    try {
      const rows = await api.social.tagged(userId);
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
