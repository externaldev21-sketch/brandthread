import { useEffect, useRef } from 'react';
import type { VideoPlayer } from 'expo-video';

/**
 * Count playback, not a page impression or an attempted play. A video only
 * enters Recently Watched after ~2 seconds of actual advancing video time.
 * Progress across short looping clips counts; a scrub forward does not.
 */
export function useMeaningfulVideoWatch(
  player: VideoPlayer,
  active: boolean,
  onWatched?: () => void,
) {
  const callback = useRef(onWatched);
  callback.current = onWatched;

  useEffect(() => {
    if (!active || !callback.current) return;
    // The full-screen feed already requests 0.25s ticks for its scrub bar.
    if (player.timeUpdateEventInterval <= 0) player.timeUpdateEventInterval = 0.5;
    let previous: number | null = null;
    let played = 0;
    let recorded = false;
    const subscription = player.addListener('timeUpdate', ({ currentTime }) => {
      if (recorded || !player.playing || !Number.isFinite(currentTime)) return;
      if (previous != null) {
        const duration = player.duration;
        const delta = currentTime >= previous
          ? currentTime - previous
          : duration > 0 ? duration - previous + currentTime : 0;
        // Ignore seek jumps and stale events after swapping video sources.
        if (delta >= 0 && delta <= 1.5) played += delta;
      }
      previous = currentTime;
      if (played >= 1.8) {
        recorded = true;
        callback.current?.();
      }
    });
    return () => subscription.remove();
  }, [active, player]);
}