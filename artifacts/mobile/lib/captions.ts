/**
 * Client helpers for video captions: the viewer's CC preference and the
 * per-post track loader. Captions only load when the `autoCaptions` flag is on.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isPreviewDemoMode } from '@/lib/devPreview';
import type { CaptionSegment } from '@/components/social/CaptionsOverlay';

export const CAPTIONS_PREF_KEY = 'bt:captions-enabled';

export interface CaptionTrack {
  language: string;
  status: 'pending' | 'ready' | 'failed';
  source: 'whisper' | 'manual';
  vttUrl: string | null;
  segments: CaptionSegment[];
}

/** Only for `&demo=1` previews: sample speech so the overlay and editor can be shown. */
export const DEMO_CAPTION_SEGMENTS: CaptionSegment[] = [
  { start: 0, end: 3, text: 'This jacket is made from recycled nylon.' },
  { start: 3, end: 6, text: 'It packs down small and fits every season.' },
  { start: 6, end: 9, text: 'Available in three colors this week.' },
];

export const DEMO_VIDEO_POST_ID = 'demo-video';

export function demoCaptionTrack(): CaptionTrack {
  return { language: 'en', status: 'ready', source: 'whisper', vttUrl: null, segments: DEMO_CAPTION_SEGMENTS };
}

/** The viewer's saved CC preference (default on once captions exist). */
export function useCaptionsPreference(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(CAPTIONS_PREF_KEY)
      .then((value) => { if (!cancelled && value !== null) setEnabled(value === '1'); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const update = useCallback((next: boolean) => {
    setEnabled(next);
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
    if (isPreviewDemoMode() && postId === DEMO_VIDEO_POST_ID) { setTrack(demoCaptionTrack()); return; }
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
