import { describe, expect, it } from 'vitest';

import {
  MAX_TRAVEL,
  REPLY_THRESHOLD,
  clampSwipeTravel,
  nextCrossedState,
  shouldClaimSwipe,
} from '../lib/swipeToReply';

describe('SwipeToReplyBubble: shouldClaimSwipe (tap/long-press vs. swipe disambiguation)', () => {
  it('never claims a plain tap (no movement at all)', () => {
    expect(shouldClaimSwipe(0, 0)).toBe(false);
  });

  it('never claims a long-press (held in place, no movement)', () => {
    expect(shouldClaimSwipe(0, 0)).toBe(false);
  });

  it('does not claim small jitter under the 8pt threshold', () => {
    expect(shouldClaimSwipe(5, 1)).toBe(false);
  });

  it('does not claim a vertical-dominant drag (e.g. list scroll)', () => {
    expect(shouldClaimSwipe(10, 20)).toBe(false);
  });

  it('does not claim a leftward drag — swipe-right only', () => {
    expect(shouldClaimSwipe(-20, 0)).toBe(false);
  });

  it('claims a clear horizontal-dominant rightward drag', () => {
    expect(shouldClaimSwipe(20, 2)).toBe(true);
  });

  it('never claims anything while disabled, even a clear rightward drag', () => {
    expect(shouldClaimSwipe(30, 0, true)).toBe(false);
  });
});

describe('SwipeToReplyBubble: clampSwipeTravel (resistance past MAX_TRAVEL)', () => {
  it('tracks 1:1 up to MAX_TRAVEL', () => {
    expect(clampSwipeTravel(10)).toBe(10);
    expect(clampSwipeTravel(MAX_TRAVEL)).toBe(MAX_TRAVEL);
  });

  it('ignores leftward drag entirely (clamped to 0)', () => {
    expect(clampSwipeTravel(-40)).toBe(0);
  });

  it('applies resistance past MAX_TRAVEL rather than a hard stop', () => {
    const past = clampSwipeTravel(MAX_TRAVEL + 40);
    expect(past).toBeGreaterThan(MAX_TRAVEL);
    expect(past).toBeLessThan(MAX_TRAVEL + 40);
    expect(past).toBeCloseTo(MAX_TRAVEL + 40 * 0.25, 5);
  });
});

describe('SwipeToReplyBubble: nextCrossedState (haptic fires once, on threshold-cross)', () => {
  it('fires a haptic the instant the drag first crosses the threshold', () => {
    const result = nextCrossedState(REPLY_THRESHOLD, false);
    expect(result).toEqual({ crossed: true, fireHaptic: true });
  });

  it('does not fire again on subsequent moves while still held past the threshold', () => {
    const result = nextCrossedState(REPLY_THRESHOLD + 10, true);
    expect(result).toEqual({ crossed: true, fireHaptic: false });
  });

  it('does not fire while still below the threshold', () => {
    const result = nextCrossedState(REPLY_THRESHOLD - 5, false);
    expect(result).toEqual({ crossed: false, fireHaptic: false });
  });

  it('clears the crossed flag (without a haptic) when dragged back below the threshold', () => {
    const result = nextCrossedState(REPLY_THRESHOLD - 1, true);
    expect(result).toEqual({ crossed: false, fireHaptic: false });
  });

  it('fires again if the drag re-crosses the threshold after dropping back below it', () => {
    const droppedBack = nextCrossedState(REPLY_THRESHOLD - 1, true);
    const reCrossed = nextCrossedState(REPLY_THRESHOLD, droppedBack.crossed);
    expect(reCrossed).toEqual({ crossed: true, fireHaptic: true });
  });
});

describe('back-swipe guard', () => {
  it('never claims a drag that starts at the left screen edge', async () => {
    const { shouldClaimSwipe, BACK_SWIPE_EDGE } = await import('@/lib/swipeToReply');
    expect(shouldClaimSwipe(40, 2, false, BACK_SWIPE_EDGE - 1)).toBe(false);
    expect(shouldClaimSwipe(40, 2, false, BACK_SWIPE_EDGE + 30)).toBe(true);
    expect(shouldClaimSwipe(40, 2, false)).toBe(true);
  });
});
