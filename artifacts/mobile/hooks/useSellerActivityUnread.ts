/**
 * True while the seller has unread activity (likes, comments, mentions,
 * reposts, saves, followers…) — the dot on the seller profile's bell. Opening
 * /seller-activity marks that activity read, which clears it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ACTIVITY_PAGE_SIZE } from '@/lib/activity';
import { hasUnreadSellerActivity } from '@/lib/sellerActivity';
import { getActivity, subscribeActivity, watchActivityRealtime } from '@/services/activityService';
import { getVisiblePreviewActivity, isPreviewActivityEnabled } from '@/lib/previewActivity';

export function useSellerActivityUnread(): boolean {
  const [unread, setUnread] = useState(false);
  const mounted = useRef(true);
  const requestId = useRef(0);

  const refresh = useCallback(() => {
    const id = ++requestId.current;
    const apply = (value: boolean) => { if (mounted.current && id === requestId.current) setUnread(value); };
    if (isPreviewActivityEnabled()) {
      // Dev web preview: seeded feed (only under &demo=1), never the API.
      apply(hasUnreadSellerActivity(getVisiblePreviewActivity()));
      return;
    }
    getActivity({ limit: ACTIVITY_PAGE_SIZE, offset: 0, filter: 'social' })
      .then((items) => apply(hasUnreadSellerActivity(items)))
      .catch(() => { /* keep the last known state */ });
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeActivity(refresh);
    const realtime = watchActivityRealtime(refresh);
    return () => {
      mounted.current = false;
      unsubscribe();
      realtime.stop();
    };
  }, [refresh]);

  return unread;
}
