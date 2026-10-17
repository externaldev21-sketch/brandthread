/**
 * Right-to-left swipe on a video opens the creator's profile (TikTok).
 * Video posts only — photo carousels own horizontal paging. Claims the
 * gesture only for a clearly horizontal leftward drag so vertical paging
 * and taps are untouched.
 */
export const PROFILE_SWIPE_CLAIM = 14;
export const PROFILE_SWIPE_TRIGGER = 70;

export function claimsProfileSwipe(dx: number, dy: number): boolean {
  return dx < -PROFILE_SWIPE_CLAIM && Math.abs(dx) > Math.abs(dy) * 2;
}
export function firesProfileSwipe(dx: number, dy: number, vx = 0): boolean {
  return Math.abs(dx) > Math.abs(dy) * 1.5 && (dx < -PROFILE_SWIPE_TRIGGER || (dx < -30 && vx < -0.5));
}
