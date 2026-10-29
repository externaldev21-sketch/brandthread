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

/** Smallest the media shrinks to mid-drag (Instagram's viewer pulls down to ~3/4 size). */
export const DISMISS_MIN_SCALE = 0.75;
/** Corner radius the media reaches mid-drag, so it reads as a card being put back. */
export const DISMISS_MAX_RADIUS = 28;

/** How far into the drag (0 → 1) the media is, over the dismiss distance x 2.5. */
function dragProgress(translationY: number): number {
  'worklet';
  return Math.min(1, Math.abs(translationY) / (DISMISS_DISTANCE * 2.5));
}

/** Media scale while dragging: shrinks with the drag, never below DISMISS_MIN_SCALE. */
export function dragScaleFor(translationY: number): number {
  'worklet';
  return 1 - (1 - DISMISS_MIN_SCALE) * dragProgress(translationY);
}

/** Media corner radius while dragging: 0 at rest, rounding in quickly as the drag starts. */
export function dragRadiusFor(translationY: number): number {
  'worklet';
  return Math.round(DISMISS_MAX_RADIUS * Math.min(1, Math.abs(translationY) / 60));
}
