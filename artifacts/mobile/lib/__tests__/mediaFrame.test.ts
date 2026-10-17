import { describe, expect, it, vi } from 'vitest';
import { aspectOf, containRect, fitForPage, resolveAspect, slideFrame } from '@/lib/mediaFrame';

describe('mediaFrame — final size on the first frame', () => {
  it('reads an aspect from stored pixel sizes', () => {
    expect(aspectOf({ width: 1080, height: 1440 })).toBeCloseTo(0.75);
    expect(aspectOf({ width: 0, height: 10 })).toBeNull();
    expect(aspectOf(null)).toBeNull();
  });

  it('letterboxes a 3:4 slideshow inside a 390x844 page at a fixed box', () => {
    expect(containRect(3 / 4, 390, 844)).toEqual({ left: 0, top: 162, width: 390, height: 520 });
    // Same input → same box every render (nothing measured at runtime).
    expect(containRect(3 / 4, 390, 844)).toEqual(containRect(3 / 4, 390, 844));
  });

  it('fits a landscape photo by height on a tall page and by width on a wide one', () => {
    expect(containRect(16 / 9, 390, 844)).toEqual({ left: 0, top: 313, width: 390, height: 219 });
    expect(containRect(9 / 16, 1024, 768)).toEqual({ left: 296, top: 0, width: 432, height: 768 });
  });

  it('covers a 9:16 clip on a phone but letterboxes a square one', () => {
    expect(fitForPage(9 / 16, 390, 844)).toBe('cover');
    expect(fitForPage(1, 390, 844)).toBe('contain');
  });

  it('falls back to the post ratio when sizes are missing, and logs it once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveAspect(null, { postId: 'p1', what: 'media[0]', ratio: '4:5' })).toBeCloseTo(0.8);
    expect(resolveAspect(undefined, { postId: 'p1', what: 'media[0]', ratio: '4:5' })).toBeCloseTo(0.8);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(resolveAspect({ width: 1080, height: 1920 }, { postId: 'p2', what: 'poster' })).toBeCloseTo(9 / 16);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('gives the overlay and the carousel one frame per fit (no size change at handoff)', () => {
    expect(slideFrame('contain', 3 / 4, 390, 844)).toEqual({
      style: { position: 'absolute', left: 0, top: 162, width: 390, height: 520 }, contentFit: 'contain',
    });
    // Full-bleed: the whole page, whatever the photo's own ratio.
    expect(slideFrame('cover', 3 / 4, 390, 844)).toEqual({
      style: { position: 'absolute', left: 0, top: 0, width: 390, height: 844 }, contentFit: 'cover',
    });
  });
});
