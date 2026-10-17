import React, { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import { subscribePostEngagement } from '@/lib/postEngagement';
import { RepostEducationSheet } from './RepostEducationSheet';

/** One host for successful reposts from the feed, viewer and share sheet. */
export function RepostEducationHost() {
  const { userId } = useAuth();
  const api = useApi();
  const scope = useRef({ userId });
  if (scope.current.userId !== userId) scope.current = { userId };
  const owner = scope.current;
  const [visibleOwner, setVisibleOwner] = useState<typeof owner | null>(null);
  const pending = useRef<typeof owner | null>(null);
  const settled = useRef<typeof owner | null>(null);

  useEffect(() => {
    if (!userId) return;
    return subscribePostEngagement(userId, (_postId, patch) => {
      if (!patch.reposted || pending.current === owner || settled.current === owner) return;
      pending.current = owner;
      void (async () => {
        const key = `bt:repost-education:${userId}:v1`;
        let locallySeen = false;
        try { locallySeen = (await AsyncStorage.getItem(key)) === 'true'; } catch { /* Server remains authoritative. */ }
        let show = !locallySeen;
        try {
          // Sync older local acknowledgements too, so another phone does not
          // repeat education that this account already saw before the update.
          show = (await api.posts.claimRepostEducation()).show && !locallySeen;
        } catch { /* Tips can still work; failure must never undo a saved repost. */ }
        if (scope.current !== owner) return;
        settled.current = owner;
        if (show) setVisibleOwner(owner);
        try { await AsyncStorage.setItem(key, 'true'); } catch { /* Server claim survives device storage failure. */ }
      })().finally(() => { if (pending.current === owner) pending.current = null; });
    });
  }, [api, owner, userId]);

  return <RepostEducationSheet visible={visibleOwner === owner} onClose={() => setVisibleOwner(null)} />;
}
