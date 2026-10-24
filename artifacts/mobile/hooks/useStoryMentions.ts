import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useStickyState } from '@/lib/stickyState';
import { useApi } from '@/lib/api';
import { getPreviewStoryMentions, isPreviewStoryMentionsEnabled } from '@/lib/previewStoryMentions';
import { isPreviewActivityEnabled } from '@/lib/previewActivity';
import type { StoryMentionItem } from '@/services/socialTypes';

/**
 * Stories that tagged me (GET /api/social/stories/mentions), refetched every
 * time the screen regains focus. In the web preview the real endpoint is never
 * called (there is no backend, and a signed-out preview must not hit protected
 * APIs): `&demo=1` reads the seed, a fresh preview gets nothing.
 */
export function useStoryMentions() {
  const api = useApi();
  // Sticky so the mentions rail above Activity's rows is already in place
  // on a remount instead of pushing every row down when it lands.
  const [items, setItems, hadItems] = useStickyState<StoryMentionItem[]>('activity:storyMentions', []);
  const [loading, setLoading] = useState(!hadItems);
  // The last fetch failed. Items on screen are kept; screens with nothing to
  // show render an error + Retry instead of the empty state.
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    if (isPreviewActivityEnabled()) {
      setItems(isPreviewStoryMentionsEnabled() ? getPreviewStoryMentions() : []);
      setError(false);
      setLoading(false);
      return;
    }
    try {
      const res = await api.social.storyMentions();
      if (id === requestId.current) { setItems(res.items); setError(false); }
    } catch {
      // Keep whatever is on screen; the rail simply stays hidden when empty.
      if (id === requestId.current) setError(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => () => { requestId.current += 1; }, []);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  return { items, loading, error, reload, setItems };
}
