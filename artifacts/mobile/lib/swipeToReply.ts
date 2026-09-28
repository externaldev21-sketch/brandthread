/**
 * Pure, RN-free gesture math for components/chat/SwipeToReplyBubble.tsx —
 * split out so it can be unit-tested without pulling in the real
 * react-native package (which vitest can't parse standalone; every other
 * RN-touching test in this repo mocks 'react-native' via vi.mock instead).
 */

// How far (pt) a bubble has to be dragged before release counts as
// "reply" — short and snappy, unlike InboxSwipeRow's full reveal-panel
// swipe (components/inbox/InboxSwipeRow.tsx), which this borrows its
// tap-vs-drag disambiguation technique from (onMoveShouldSetPanResponder
// only claims the gesture once horizontal movement clearly exceeds a
// threshold, so a tap or long-press on the bubble underneath still passes
// straight through untouched).
export const REPLY_THRESHOLD = 44;
// The bubble itself is allowed to travel a little further than the
// threshold, with resistance past it, so the release point doesn't feel
// like a hard wall.
export const MAX_TRAVEL = 64;

/** Pure gesture-claim decision. A tap has dx === dy === 0 (never claimed);
 *  a long-press never moves either. Only a clear, horizontal-dominant
 *  rightward drag claims the gesture. */
export function shouldClaimSwipe(dx: number, dy: number, disabled = false): boolean {
  return !disabled && dx > 8 && Math.abs(dx) > Math.abs(dy) * 1.5;
}

/** Pure translateX-with-resistance math for a given raw horizontal drag
 *  distance — negative drag (leftward) is ignored (swipe-right only). */
export function clampSwipeTravel(dx: number): number {
  const forward = Math.max(0, dx);
  return forward <= MAX_TRAVEL ? forward : MAX_TRAVEL + (forward - MAX_TRAVEL) * 0.25;
}

/** Given the previous "have we already crossed the threshold" flag and the
 *  current raw dx, returns the next flag value and whether a haptic should
 *  fire on this move (i.e. this move is the one that crosses the threshold
 *  — never re-fired while held past it; crossing back below resets it so a
 *  re-cross fires again, matching the on-screen icon's own reveal state). */
export function nextCrossedState(dx: number, wasCrossed: boolean): { crossed: boolean; fireHaptic: boolean } {
  const isPast = dx >= REPLY_THRESHOLD;
  if (isPast && !wasCrossed) return { crossed: true, fireHaptic: true };
  if (!isPast && wasCrossed) return { crossed: false, fireHaptic: false };
  return { crossed: wasCrossed, fireHaptic: false };
}
