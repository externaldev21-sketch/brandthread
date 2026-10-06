/**
 * Viewer/host-side state for live moderation + co-hosts: the pinned comment
 * and the accepted co-host list. The screen forwards live-socket events to
 * `handleEvent` and calls `refresh` on (re)connect for the HTTP backfill.
 */
import { useCallback, useState } from 'react';
import { useApi } from '@/lib/api';
import type { LiveSocketEvent } from '@/lib/live/useLiveSocket';
import type { LiveCohostPerson } from '@/lib/live/moderationTypes';

export interface PinnedComment { id: string; user_id?: string; display_name: string; message: string }

export function useLiveModeration(streamId: string | undefined) {
  const api = useApi();
  const [pinned, setPinned] = useState<PinnedComment | null>(null);
  const [cohosts, setCohosts] = useState<LiveCohostPerson[]>([]);

  const refresh = useCallback(() => {
    if (!streamId) return;
    api.liveMod.pinned(streamId).then((r) => setPinned(r.pinnedComment ?? null)).catch(() => {});
    api.liveCohost.list(streamId).then((r) => setCohosts(r.cohosts ?? [])).catch(() => {});
  }, [api, streamId]);

  /** Returns true when the event was a moderation/co-host event and has been handled. */
  const handleEvent = useCallback((event: LiveSocketEvent): boolean => {
    switch (event.type) {
      case 'comment_pinned':
        setPinned(event.comment ?? null);
        return true;
      case 'comment_removed':
        setPinned((prev) => (prev && prev.id === event.commentId ? null : prev));
        return true;
      case 'cohosts':
        setCohosts(event.cohosts ?? []);
        return true;
      default:
        return false;
    }
  }, []);

  return { pinned, cohosts, refresh, handleEvent };
}
