/**
 * Hooks that wire joined communities into the app's inboxes and tab badges.
 * Readonly mode (signed out / fresh preview) yields [] — no protected call.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { notifyJoinedCommunitiesChanged, subscribeJoinedCommunitiesChanged } from './changeBus';
import type { Community } from './types';
import { loudUnreadTotal } from './types';
import { useCommunityClient, useJoinedCommunities } from './useCommunityClient';

/** Joined communities for a Messages inbox: refreshes on focus, optimistic mute. */
export function useInboxCommunities(): {
  communities: Community[];
  toggleMute: (c: Community) => Promise<void>;
} {
  const client = useCommunityClient();
  const { communities, reload } = useJoinedCommunities();
  const [muteOverrides, setMuteOverrides] = useState<Record<string, boolean>>({});

  useFocusEffect(useCallback(() => {
    void reload().then(() => notifyJoinedCommunitiesChanged());
  }, [reload]));

  // Server state caught up → drop overrides so later server changes win.
  useEffect(() => { setMuteOverrides({}); }, [communities]);

  const toggleMute = useCallback(async (c: Community) => {
    const next = !(muteOverrides[c.id] ?? c.muted);
    setMuteOverrides((cur) => ({ ...cur, [c.id]: next }));
    try {
      await client.setMuted(c.id, next);
      void reload().then(() => notifyJoinedCommunitiesChanged());
    } catch {
      setMuteOverrides((cur) => { const { [c.id]: _drop, ...rest } = cur; return rest; });
      Alert.alert(next ? 'Couldn’t mute' : 'Couldn’t unmute', 'Please try again.');
    }
  }, [client, muteOverrides, reload]);

  const merged = useMemo(
    () => communities.map((c) => (c.id in muteOverrides ? { ...c, muted: muteOverrides[c.id] } : c)),
    [communities, muteOverrides],
  );
  return { communities: merged, toggleMute };
}

/** Unread total for the Messages tab badge — muted communities contribute nothing. */
export function useCommunityBadgeCount(pollMs = 45_000): number {
  const { communities, reload } = useJoinedCommunities(pollMs);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => subscribeJoinedCommunitiesChanged(() => { void reloadRef.current(); }), []);
  return loudUnreadTotal(communities);
}
