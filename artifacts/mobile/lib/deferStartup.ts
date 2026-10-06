/**
 * Runs non-critical start-up work after the first screen has had a chance to
 * paint, instead of inside the first render/effect pass.
 *
 * Uses InteractionManager (native: after the initial animations and layout
 * settle; web: after the next frame) and a timeout ceiling so the work still
 * runs if an animation keeps the interaction queue busy. Returns a cancel
 * function for effect cleanup. Crash reporting is deliberately NOT deferred.
 */
import { InteractionManager } from 'react-native';

export const DEFER_CEILING_MS = 3000;

export function runAfterFirstPaint(task: () => void, ceilingMs: number = DEFER_CEILING_MS): () => void {
  let done = false;
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
  const handle = InteractionManager.runAfterInteractions(run);
  const timer = setTimeout(run, ceilingMs);
  return () => {
    done = true;
    clearTimeout(timer);
    handle.cancel();
  };
}
