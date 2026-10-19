/**
 * Runs non-critical start-up work after the first screen has had a chance to
 * paint, instead of inside the first render/effect pass.
 *
 * Gives the initial commit two animation frames, then uses InteractionManager
 * and a timeout ceiling so an animation cannot starve background work. Returns a cancel
 * function for effect cleanup. Crash reporting is deliberately NOT deferred.
 */
import { InteractionManager } from 'react-native';

export const DEFER_CEILING_MS = 3000;

export function runAfterFirstPaint(task: () => void, ceilingMs: number = DEFER_CEILING_MS): () => void {
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let handle: ReturnType<typeof InteractionManager.runAfterInteractions> | undefined;
  const requestFrame = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 16) as unknown as number;
  const cancelFrame = typeof cancelAnimationFrame === 'function'
    ? cancelAnimationFrame
    : (id: number) => clearTimeout(id);
  const run = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    try {
      task();
    } catch {
      // Deferred warm-up must never take the app down.
    }
  };
  let frame = requestFrame(() => {
    if (done) return;
    frame = requestFrame(() => {
      if (done) return;
      timer = setTimeout(run, ceilingMs);
      handle = InteractionManager.runAfterInteractions(run);
    });
  });
  return () => {
    done = true;
    clearTimeout(timer);
    cancelFrame(frame);
    handle?.cancel();
  };
}
