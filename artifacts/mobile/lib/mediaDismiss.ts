/**
 * Swipe-down-to-close math shared by every full-screen media viewer (Dev's
 * less-AI pass, item 53). Worklet-safe and dependency-free so it runs on the
 * UI thread inside a gesture and in unit tests alike.
 */

/** How far (pt) a swipe down has to travel, or how fast (pt/s), to close. */
export const DISMISS_DISTANCE = 120;
export const DISMISS_VELOCITY = 900;

/** Does a released vertical drag close the viewer? */
export function shouldDismiss(translationY: number, velocityY: number): boolean {
  'worklet';
  return Math.abs(translationY) > DISMISS_DISTANCE || Math.abs(velocityY) > DISMISS_VELOCITY;
}

/** Backdrop opacity while dragging: thins out with the drag, never fully clear. */
export function backdropOpacityFor(translationY: number): number {
  'worklet';
  return Math.max(0.2, 1 - Math.abs(translationY) / (DISMISS_DISTANCE * 3));
}
