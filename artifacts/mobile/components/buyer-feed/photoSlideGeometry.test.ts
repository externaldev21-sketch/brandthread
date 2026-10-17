import { describe, expect, it } from 'vitest';
import { containRect, resolveSlideAspect } from './photoSlideGeometry';

describe('photo slide geometry', () => {
  it('letterboxes a square slide on a 390x844 page', () => {
    expect(containRect(390, 844, 1)).toEqual({ left: 0, top: 227, width: 390, height: 390 });
  });
  it('pillarboxes a tall 9:21 slide without distortion', () => {
    const r = containRect(390, 844, 9 / 21);
    expect(r.height).toBe(844);
    expect(r.width / r.height).toBeCloseTo(9 / 21);
    expect(r.left).toBeCloseTo((390 - r.width) / 2);
  });
  it('keeps 4:5 and 16:9 inside the page', () => {
    for (const a of [4 / 5, 16 / 9, 3 / 4]) {
      const r = containRect(390, 844, a);
      expect(r.width).toBeLessThanOrEqual(390);
      expect(r.height).toBeLessThanOrEqual(844);
      expect(r.width / r.height).toBeCloseTo(a);
    }
  });
  it('falls back to full page when aspect unknown and zero on empty page', () => {
    expect(containRect(390, 844)).toEqual({ left: 0, top: 0, width: 390, height: 844 });
    expect(containRect(0, 844, 1).width).toBe(0);
  });
  it('prefers authored aspect over natural size', () => {
    expect(resolveSlideAspect(0.8, { width: 1000, height: 1000 })).toBe(0.8);
    expect(resolveSlideAspect(undefined, { width: 1080, height: 1350 })).toBeCloseTo(0.8);
    expect(resolveSlideAspect(NaN, { width: 0, height: 10 })).toBeUndefined();
  });
});
