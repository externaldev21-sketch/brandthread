// Instagram micro-interactions pack: the pure rules behind the gestures.
import { describe, expect, it } from 'vitest';
import {
  DISMISS_DISTANCE, DISMISS_MAX_RADIUS, DISMISS_MIN_SCALE, dragRadiusFor, dragScaleFor,
} from '@/lib/mediaDismiss';
import { EDGE_TAP_FRACTION, edgeTapDirection } from '@/lib/feed/edgeTap';
import { NEW_POSTS_MIN_INDEX, freshPostIds, shouldCheckForNewPosts } from '@/lib/feed/newPostsPill';

describe('swipe-down dismiss shrinks and rounds the media (3)', () => {
  it('is untouched at rest', () => {
    expect(dragScaleFor(0)).toBe(1);
    expect(dragRadiusFor(0)).toBe(0);
  });
  it('shrinks with the drag, either direction, never below the floor', () => {
    expect(dragScaleFor(DISMISS_DISTANCE)).toBeLessThan(1);
    expect(dragScaleFor(DISMISS_DISTANCE)).toBeGreaterThan(DISMISS_MIN_SCALE);
    expect(dragScaleFor(-DISMISS_DISTANCE)).toBe(dragScaleFor(DISMISS_DISTANCE));
    expect(dragScaleFor(5000)).toBe(DISMISS_MIN_SCALE);
  });
  it('rounds the corners in quickly and caps them', () => {
    expect(dragRadiusFor(30)).toBeGreaterThan(0);
    expect(dragRadiusFor(30)).toBeLessThan(DISMISS_MAX_RADIUS);
    expect(dragRadiusFor(400)).toBe(DISMISS_MAX_RADIUS);
  });
});

describe('carousel edge taps (6)', () => {
  const W = 390;
  it('outer quarters step, the middle keeps the page tap', () => {
    expect(edgeTapDirection(10, W, 3)).toBe(-1);
    expect(edgeTapDirection(W * EDGE_TAP_FRACTION - 1, W, 3)).toBe(-1);
    expect(edgeTapDirection(W / 2, W, 3)).toBe(0);
    expect(edgeTapDirection(W - 10, W, 3)).toBe(1);
  });
  it('single photos and bad input never step', () => {
    expect(edgeTapDirection(10, W, 1)).toBe(0);
    expect(edgeTapDirection(10, 0, 3)).toBe(0);
    expect(edgeTapDirection(Number.NaN, W, 3)).toBe(0);
  });
});

describe('"New posts" pill (4)', () => {
  it('only counts top posts the list does not have', () => {
    expect(freshPostIds(['a', 'b', 'c'], ['a', 'b'])).toEqual([]);
    expect(freshPostIds(['a', 'b'], ['z', 'a', 'b'])).toEqual(['z']);
  });
  it('checks only while scrolled into a loaded, focused feed with no pill up', () => {
    const base = { focused: true, activeIndex: NEW_POSTS_MIN_INDEX, loading: false, pillShown: false, hasPosts: true };
    expect(shouldCheckForNewPosts(base)).toBe(true);
    expect(shouldCheckForNewPosts({ ...base, activeIndex: 0 })).toBe(false);
    expect(shouldCheckForNewPosts({ ...base, focused: false })).toBe(false);
    expect(shouldCheckForNewPosts({ ...base, loading: true })).toBe(false);
    expect(shouldCheckForNewPosts({ ...base, pillShown: true })).toBe(false);
    expect(shouldCheckForNewPosts({ ...base, hasPosts: false })).toBe(false);
  });
});
