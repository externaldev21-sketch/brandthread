import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_TRENDING_MAX, activityFooterParts, inlineTrendingBrands, showsInlineTrending,
} from './activityTrending';
import type { TrendingBrandRow } from './discoveryShelves';

const brand = (id: string): TrendingBrandRow => ({ id, name: `Brand ${id}`, verified: false });
const base = { loadingMore: false, hasMore: false, trendingCount: 5, suggestedCount: 0, chip: 'all' as const };

describe('inlineTrendingBrands', () => {
  it('caps the inline list at about 5-8 rows', () => {
    const rows = Array.from({ length: 12 }, (_, i) => brand(`b${i}`));
    expect(ACTIVITY_TRENDING_MAX).toBeGreaterThanOrEqual(5);
    expect(ACTIVITY_TRENDING_MAX).toBeLessThanOrEqual(8);
    expect(inlineTrendingBrands(rows, 'me')).toHaveLength(ACTIVITY_TRENDING_MAX);
  });

  it('never shows the viewer their own store, or the same brand twice', () => {
    const out = inlineTrendingBrands([brand('me'), brand('a'), brand('a'), brand('b')], 'me');
    expect(out.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('keeps the server ranking order', () => {
    expect(inlineTrendingBrands([brand('c'), brand('a'), brand('b')], null).map((b) => b.id)).toEqual(['c', 'a', 'b']);
  });

  it('is empty when nothing is trending (the section then hides)', () => {
    expect(inlineTrendingBrands([], 'me')).toEqual([]);
    expect(inlineTrendingBrands([brand('me')], 'me')).toEqual([]);
  });
});

describe('activityFooterParts — order under the activity rows', () => {
  it('puts Trending brands in the footer, after the activity rows and the paging spinner', () => {
    // The footer renders after every activity row, so trending is always below them.
    expect(activityFooterParts({ ...base, loadingMore: true, suggestedCount: 2 }))
      .toEqual(['loadingMore', 'trending', 'suggested']);
  });

  it('waits for the last page, so it never shows mid-list and then jumps down', () => {
    expect(activityFooterParts({ ...base, hasMore: true })).not.toContain('trending');
    expect(activityFooterParts({ ...base, hasMore: true, loadingMore: true })).toEqual(['loadingMore']);
    expect(activityFooterParts({ ...base, hasMore: false })).toEqual(['trending']);
  });

  it('appears exactly once', () => {
    const parts = activityFooterParts({ ...base, loadingMore: true, suggestedCount: 3 });
    expect(parts.filter((p) => p === 'trending')).toHaveLength(1);
  });

  it('hides the section entirely when there are no trending brands', () => {
    expect(activityFooterParts({ ...base, trendingCount: 0 })).toEqual([]);
    expect(activityFooterParts({ ...base, trendingCount: 0, suggestedCount: 1 })).toEqual(['suggested']);
  });

  it('shows on All and Follows (where "Find people to follow" was), not on the other filters', () => {
    expect(showsInlineTrending('all')).toBe(true);
    expect(showsInlineTrending('follows')).toBe(true);
    for (const chip of ['likes', 'comments', 'mentions', 'orders', 'thread_cash'] as const) {
      expect(showsInlineTrending(chip)).toBe(false);
      expect(activityFooterParts({ ...base, chip })).not.toContain('trending');
    }
  });
});
