/**
 * Client helpers for video captions: the viewer's CC preference and the
 * per-post track loader. Captions only load when the `autoCaptions` flag is on.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CaptionSegment } from '@/components/social/CaptionsOverlay';

export const CAPTIONS_PREF_KEY = 'bt:captions-enabled';

export interface CaptionTrack {
  language: string;
  status: 'pending' | 'ready' | 'failed';
  source: 'whisper' | 'manual';
  vttUrl: string | null;
  segments: CaptionSegment[];
}

// One shared value so every mounted player (each feed page has its own)
// flips together when the viewer toggles captions on any of them.
let sharedCaptionsEnabled: boolean | null = null;
const captionsListeners = new Set<(on: boolean) => void>();

/** The viewer's saved CC preference (default on once captions exist). */
export function useCaptionsPreference(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState(sharedCaptionsEnabled ?? true);
  useEffect(() => {
    let cancelled = false;
    captionsListeners.add(setEnabled);
    if (sharedCaptionsEnabled === null) {
      void AsyncStorage.getItem(CAPTIONS_PREF_KEY)
        .then((value) => {
          if (value === null || sharedCaptionsEnabled !== null) return;
          sharedCaptionsEnabled = value === '1';
          if (!cancelled) captionsListeners.forEach((fn) => fn(sharedCaptionsEnabled!));
        })
        .catch(() => {});
    }
    return () => { cancelled = true; captionsListeners.delete(setEnabled); };
  }, []);
  const update = useCallback((next: boolean) => {
    sharedCaptionsEnabled = next;
    captionsListeners.forEach((fn) => fn(next));
    void AsyncStorage.setItem(CAPTIONS_PREF_KEY, next ? '1' : '0').catch(() => {});
  }, []);
  return [enabled, update];
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
