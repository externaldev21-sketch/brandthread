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
  // Latest plan inputs, so the manager can apply them the moment it exists.
  const planInputsRef = useRef({ items, activeIndex });
  planInputsRef.current = { items, activeIndex };

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
      const manager = new VideoPreloadManager({
        isDataSaver: () => detectDataSaver(),
        createWarmPlayer: (uri) => {
          const player = createVideoPlayer({ uri, useCaching: true });
          player.muted = true;
          player.loop = false;
          return { release: () => player.release() };
        },
      });
      managerRef.current = manager;
      // Apply the current plan as soon as the manager is ready, however long
      // the dynamic import took (replaces a fixed 400ms retry).
      const { items: latestItems, activeIndex: latestIndex } = planInputsRef.current;
      manager.update(planVideoPreload(latestItems, latestIndex));
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
    if (!active) return;
    // Before the dynamic import resolves there is no manager yet; the import
    // callback above applies the latest plan itself once it creates one.
    managerRef.current?.update(planVideoPreload(items, activeIndex));
  }, [active, items, activeIndex]);
}
