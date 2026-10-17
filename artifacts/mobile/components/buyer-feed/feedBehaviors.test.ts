import { describe, expect, it, vi, afterEach } from 'vitest';
import { claimsProfileSwipe, firesProfileSwipe } from './horizontalProfileSwipe';
import { nextSlide, shouldAutoAdvance, PHOTO_AUTO_ADVANCE_MS } from './photoAutoAdvance';
import { trendingCardSize } from './FollowingTrendingCreators';
import { verticalPagerListProps } from '@/lib/feedPager';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) } }));

describe('feed behaviors', () => {
  afterEach(() => vi.useRealTimers());
  it('RTL swipe claims only clear leftward horizontal drags', () => {
    expect(claimsProfileSwipe(-30, 4)).toBe(true);
    expect(claimsProfileSwipe(30, 2)).toBe(false);
    expect(claimsProfileSwipe(-20, 40)).toBe(false);
    expect(firesProfileSwipe(-90, 10)).toBe(true);
    expect(firesProfileSwipe(-40, 5, -0.8)).toBe(true);
    expect(firesProfileSwipe(-40, 5, -0.1)).toBe(false);
  });
  it('photo auto-advance runs only when enabled, active, unzoomed, not held, multi-slide', () => {
    const base = { enabled: true, active: true, zoomed: false, holding: false, count: 3 };
    expect(shouldAutoAdvance(base)).toBe(true);
    expect(shouldAutoAdvance({ ...base, enabled: false })).toBe(false);
    expect(shouldAutoAdvance({ ...base, zoomed: true })).toBe(false);
    expect(shouldAutoAdvance({ ...base, holding: true })).toBe(false);
    expect(shouldAutoAdvance({ ...base, active: false })).toBe(false);
    expect(shouldAutoAdvance({ ...base, count: 1 })).toBe(false);
    expect(nextSlide(2, 3)).toBe(0);
    expect(PHOTO_AUTO_ADVANCE_MS).toBe(3000);
  });
  it('vertical pager pages exactly one post per flick', () => {
    const p = verticalPagerListProps(800, 10);
    expect(p.pagingEnabled).toBe(true);
    expect(p.disableIntervalMomentum).toBe(true);
    expect(p.getItemLayout(null, 3)).toEqual({ length: 800, offset: 2400, index: 3 });
  });
  it('trending cards are tall and centered-sized like following-2', () => {
    const s = trendingCardSize(390);
    expect(s.width).toBe(277);
    expect(s.height).toBeGreaterThan(s.width);
  });
});
