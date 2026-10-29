/**
 * Micro-interactions pack 2 — the pure rules behind the gestures:
 * chart scrubbing's finger → bucket mapping (item 17) and the profile
 * content-tab swipe's commit rule (item 31).
 */
import { describe, expect, it } from 'vitest';
import { scrubIndexForX } from '@/components/analytics/ChartScrub';
import { resolveTabSwipe, TAB_SWIPE_COMMIT } from '@/components/profile/useProfileTabSwipe';

describe('scrubIndexForX', () => {
  it('line charts: bucket i sits at i/(n-1) of the plot and rounds to the nearest', () => {
    // 5 buckets over a 400pt plot starting at x=40 → every 100pt.
    expect(scrubIndexForX(40, 5, 40, 400, false)).toBe(0);
    expect(scrubIndexForX(40 + 149, 5, 40, 400, false)).toBe(1);
    expect(scrubIndexForX(40 + 151, 5, 40, 400, false)).toBe(2);
    expect(scrubIndexForX(440, 5, 40, 400, false)).toBe(4);
  });

  it('bar charts: each bucket owns an equal slot', () => {
    // 4 bars over 400pt → 100pt slots.
    expect(scrubIndexForX(0, 4, 0, 400, true)).toBe(0);
    expect(scrubIndexForX(99, 4, 0, 400, true)).toBe(0);
    expect(scrubIndexForX(100, 4, 0, 400, true)).toBe(1);
    expect(scrubIndexForX(399, 4, 0, 400, true)).toBe(3);
  });

  it('clamps a finger past either edge of the plot (and over the y-axis gutter)', () => {
    expect(scrubIndexForX(-50, 5, 40, 400, false)).toBe(0);
    expect(scrubIndexForX(10, 5, 40, 400, false)).toBe(0);
    expect(scrubIndexForX(900, 5, 40, 400, false)).toBe(4);
    expect(scrubIndexForX(900, 4, 0, 400, true)).toBe(3);
  });

  it('has no bucket for an empty or unmeasured chart', () => {
    expect(scrubIndexForX(100, 0, 0, 400, false)).toBe(-1);
    expect(scrubIndexForX(100, 5, 0, 0, false)).toBe(-1);
  });
});

describe('resolveTabSwipe', () => {
  const W = 390;
  it('commits to the next tab past the threshold (swipe left) and the previous (swipe right)', () => {
    const past = W * TAB_SWIPE_COMMIT + 1;
    expect(resolveTabSwipe(1, 3, -past, 0, W)).toBe(2);
    expect(resolveTabSwipe(1, 3, past, 0, W)).toBe(0);
  });

  it('a short, slow drag springs back to the current tab', () => {
    expect(resolveTabSwipe(1, 3, -40, 0.1, W)).toBe(1);
    expect(resolveTabSwipe(1, 3, 40, -0.1, W)).toBe(1);
  });

  it('a short flick still commits', () => {
    expect(resolveTabSwipe(0, 3, -40, -0.8, W)).toBe(1);
  });

  it('never runs past the first or last tab', () => {
    expect(resolveTabSwipe(0, 3, 300, 1, W)).toBe(0);
    expect(resolveTabSwipe(2, 3, -300, -1, W)).toBe(2);
  });
});
