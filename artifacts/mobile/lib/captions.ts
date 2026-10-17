/**
 * Client helpers for video captions: the viewer's CC preference and the
 * per-post track loader. Captions only load when the `autoCaptions` flag is on.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { patchBuyerSettings } from '@/lib/buyerSettings';
import { useBuyerSettings } from '@/hooks/useBuyerSettings';
import type { CaptionSegment } from '@/components/social/CaptionsOverlay';

export const CAPTIONS_PREF_KEY = 'bt:captions-enabled';

export interface CaptionTrack {
  language: string;
  status: 'pending' | 'ready' | 'failed';
  source: 'whisper' | 'manual';
  vttUrl: string | null;
  segments: CaptionSegment[];
}

/**
 * The viewer's CC preference — the account's "Always show captions" setting
 * (Settings → Accessibility), so the CC button and the setting are one value.
 * Toggling CC here saves it locally at once and syncs it to the account.
 */
export function useCaptionsPreference(): [boolean, (next: boolean) => void] {
  const { captions } = useBuyerSettings();
  const api = useApi();
  const update = useCallback((next: boolean) => {
    void patchBuyerSettings({ captions: next });
    api.meSettings.update({ captions: next }).catch(() => {});
  }, [api]);
  return [captions, update];
}

/** First ready track of a video post, or null. Never throws; 503/404 read as "no captions". */
export function useReadyCaptionTrack(
  postId: string | undefined,
  isVideo: boolean,
  flagOn: boolean,
  fetchTracks: (id: string) => Promise<{ tracks: CaptionTrack[] }>,
): CaptionTrack | null {
  const [track, setTrack] = useState<CaptionTrack | null>(null);
  useEffect(() => {
    if (!postId || !isVideo || !flagOn) { setTrack(null); return; }
    let cancelled = false;
    fetchTracks(postId)
      .then((res) => {
        if (cancelled) return;
        setTrack(res.tracks.find((t) => t.status === 'ready' && t.segments.length > 0) ?? null);
      })
      .catch(() => { if (!cancelled) setTrack(null); });
    return () => { cancelled = true; };
  }, [postId, isVideo, flagOn, fetchTracks]);
  return track;
}
