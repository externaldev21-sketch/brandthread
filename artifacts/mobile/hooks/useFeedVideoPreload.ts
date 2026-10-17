import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { prefetchImage } from '@/lib/prefetch';
import {
  VideoPreloadManager,
  detectDataSaver,
  planVideoPreload,
  type PreloadCandidate,
  preloadVideoBytes,
} from '@/lib/videoPreload';

/**
 * Warms bytes and posters without allocating decoders. Only the feed's
 * three visible-neighbour VideoVisuals own players. Inert off-screen, in the
 * background, and when the OS or viewer requests data-saver.
 */
export function useFeedVideoPreload(
  items: readonly PreloadCandidate[],
  activeIndex: number,
  enabled: boolean,
  /** The viewer turned on "Use less cellular data": nothing is fetched ahead. */
  userDataSaver = false,
): void {
  const managerRef = useRef<VideoPreloadManager | null>(null);
  const active = enabled && !userDataSaver;
  // Latest plan inputs for foreground recovery.
  const planInputsRef = useRef({ items, activeIndex });
  planInputsRef.current = { items, activeIndex };

  useEffect(() => {
    if (!active) return undefined;
      const manager = new VideoPreloadManager({
        isDataSaver: () => detectDataSaver(),
        maxWarm: 2,
        createWarmPlayer: (uri) => {
          const controller = new AbortController();
          void preloadVideoBytes(uri, controller.signal).catch(() => {});
          return { release: () => controller.abort() };
        },
      });
      managerRef.current = manager;
      // Apply the initial network-only preload plan.
      const { items: latestItems, activeIndex: latestIndex } = planInputsRef.current;
      manager.update(planVideoPreload(latestItems, latestIndex, { mountedAhead: 0 }));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') managerRef.current?.cancel();
      else {
        const { items, activeIndex } = planInputsRef.current;
        managerRef.current?.update(planVideoPreload(items, activeIndex, { mountedAhead: 0 }));
      }
    });
    return () => {
      subscription.remove();
      managerRef.current?.cancel();
      managerRef.current = null;
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const plan = planVideoPreload(items, activeIndex, { mountedAhead: 0 });
    managerRef.current?.update(plan);
    for (const uri of plan.slice(0, 2)) {
      const poster = items.find(item => item.uri === uri)?.posterUri;
      if (poster) prefetchImage(poster);
    }
  }, [active, items, activeIndex]);
}
