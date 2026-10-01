import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import {
  VIDEO_CACHE_BYTES,
  VideoPreloadManager,
  detectDataSaver,
  planVideoPreload,
  type PreloadCandidate,
} from '@/lib/videoPreload';

let cacheConfigured = false;

/**
 * Keeps the videos just ahead of the active feed page buffering (and cached on
 * disk) so a swipe lands on a video that is already loaded. Inert on web (the
 * browser owns <video> buffering), when signed out, in the background, and
 * when the OS reports data-saver. See lib/videoPreload.ts.
 */
export function useFeedVideoPreload(
  items: readonly PreloadCandidate[],
  activeIndex: number,
  enabled: boolean,
): void {
  const managerRef = useRef<VideoPreloadManager | null>(null);
  const active = enabled && Platform.OS !== 'web';

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    void import('expo-video').then(({ createVideoPlayer, setVideoCacheSizeAsync }) => {
      if (cancelled) return;
      if (!cacheConfigured) {
        cacheConfigured = true;
        // Rejects if a player already exists; the default cache size still applies then.
        void setVideoCacheSizeAsync(VIDEO_CACHE_BYTES).catch(() => {});
      }
      managerRef.current = new VideoPreloadManager({
        isDataSaver: () => detectDataSaver(),
        createWarmPlayer: (uri) => {
          const player = createVideoPlayer({ uri, useCaching: true });
          player.muted = true;
          player.loop = false;
          return { release: () => player.release() };
        },
      });
    }).catch(() => {});
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') managerRef.current?.cancel();
    });
    return () => {
      cancelled = true;
      subscription.remove();
      managerRef.current?.cancel();
      managerRef.current = null;
    };
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;
    const apply = () => managerRef.current?.update(planVideoPreload(items, activeIndex));
    apply();
    if (managerRef.current) return undefined;
    // The manager is created after the dynamic import resolves; try again shortly.
    const timer = setTimeout(apply, 400);
    return () => clearTimeout(timer);
  }, [active, items, activeIndex]);
}
