/**
 * Pure index math for the story viewer's navigation gestures, extracted so
 * tap/swipe behavior (advance, retreat, jump to next/previous user) can be
 * unit tested without mounting the full-screen viewer.
 */

export type NavResult = { storyIdx: number; slideIdx: number; shouldClose: boolean };

/** Tap-right / auto-advance-on-timer: next slide, or next user's story, or close. */
export function advance(storyIdx: number, slideIdx: number, slideCounts: number[]): NavResult {
  const currentCount = slideCounts[storyIdx] ?? 0;
  if (slideIdx < currentCount - 1) {
    return { storyIdx, slideIdx: slideIdx + 1, shouldClose: false };
  }
  if (storyIdx < slideCounts.length - 1) {
    return { storyIdx: storyIdx + 1, slideIdx: 0, shouldClose: false };
  }
  return { storyIdx, slideIdx, shouldClose: true };
}

/** Tap-left: previous slide, or the last slide of the previous user's story. */
export function retreat(storyIdx: number, slideIdx: number, slideCounts: number[]): NavResult {
  if (slideIdx > 0) {
    return { storyIdx, slideIdx: slideIdx - 1, shouldClose: false };
  }
  if (storyIdx > 0) {
    const prevCount = slideCounts[storyIdx - 1] ?? 1;
    return { storyIdx: storyIdx - 1, slideIdx: Math.max(0, prevCount - 1), shouldClose: false };
  }
  return { storyIdx, slideIdx, shouldClose: false };
}

/** Swipe left: jump straight to the next user's story reel (from its first slide). */
export function nextUser(storyIdx: number, userCount: number): NavResult {
  if (storyIdx < userCount - 1) {
    return { storyIdx: storyIdx + 1, slideIdx: 0, shouldClose: false };
  }
  return { storyIdx, slideIdx: 0, shouldClose: true };
}

/** Swipe right: jump straight to the previous user's story reel (from its first slide). */
export function prevUser(storyIdx: number): NavResult {
  if (storyIdx > 0) {
    return { storyIdx: storyIdx - 1, slideIdx: 0, shouldClose: false };
  }
  return { storyIdx, slideIdx: 0, shouldClose: false };
}

/** Classifies a released pan gesture into the viewer's four dismiss/nav gestures. */
export function classifyGesture(
  dx: number,
  dy: number,
  swipeThreshold = 60,
  closeThreshold = 80,
): 'next-user' | 'prev-user' | 'close' | 'none' {
  const horizontal = Math.abs(dx) > Math.abs(dy);
  if (horizontal) {
    if (dx <= -swipeThreshold) return 'next-user';
    if (dx >= swipeThreshold) return 'prev-user';
    return 'none';
  }
  if (dy > closeThreshold) return 'close';
  return 'none';
}
