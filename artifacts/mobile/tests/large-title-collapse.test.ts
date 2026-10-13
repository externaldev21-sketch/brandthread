import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LARGE_TITLE_THRESHOLD,
  largeTitleCollapseAt,
  largeTitleCollapseRanges,
  normalizeThreshold,
} from '@/lib/largeTitleCollapse';

describe('large title collapse math', () => {
  it('is exactly the resting header at offset 0 and when pulled down past the top', () => {
    for (const y of [0, -40]) {
      const s = largeTitleCollapseAt(y, 24);
      expect(s.largeTitleTranslateY).toBeCloseTo(0);
      expect(s.largeTitleOpacity).toBe(1);
      expect(s.compactTitleOpacity).toBe(0);
      expect(s.collapsed).toBe(false);
    }
  });

  it('moves the large title 1:1 with the scroll until it has moved its own height', () => {
    expect(largeTitleCollapseAt(6, 24).largeTitleTranslateY).toBe(-6);
    expect(largeTitleCollapseAt(18, 24).largeTitleTranslateY).toBe(-18);
    expect(largeTitleCollapseAt(24, 24).largeTitleTranslateY).toBe(-24);
    expect(largeTitleCollapseAt(400, 24).largeTitleTranslateY).toBe(-24);
  });

  it('fades the compact title in over the second half, fully in at the threshold', () => {
    expect(largeTitleCollapseAt(12, 24).compactTitleOpacity).toBe(0);
    expect(largeTitleCollapseAt(18, 24).compactTitleOpacity).toBeCloseTo(0.5);
    const done = largeTitleCollapseAt(24, 24);
    expect(done.compactTitleOpacity).toBe(1);
    expect(done.largeTitleOpacity).toBe(0);
    expect(done.collapsed).toBe(true);
  });

  it('uses the measured height as the threshold', () => {
    const r = largeTitleCollapseRanges(30);
    expect(r.largeTitleTranslateY.inputRange).toEqual([0, 30]);
    expect(r.largeTitleTranslateY.outputRange).toEqual([0, -30]);
    expect(r.compactTitleOpacity.inputRange).toEqual([15, 30]);
    expect(r.largeTitleOpacity.extrapolate).toBe('clamp');
  });

  it('falls back to the default before a usable measurement exists', () => {
    expect(normalizeThreshold(0)).toBe(DEFAULT_LARGE_TITLE_THRESHOLD);
    expect(normalizeThreshold(Number.NaN)).toBe(DEFAULT_LARGE_TITLE_THRESHOLD);
    expect(normalizeThreshold(27.5)).toBe(27.5);
  });
});
