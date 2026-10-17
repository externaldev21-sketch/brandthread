import { describe, expect, it } from 'vitest';
import {
  DIRECTION_LOCK_PT, MAX_ZOOM, clampPan, decideDirection, focalZoom, pagerOffset, releaseZoom,
  rubberBand, snapIndex, stickyDirection,
} from '../carouselGestureMath';

describe('direction lock', () => {
  it('stays undecided below 10pt', () => {
    expect(DIRECTION_LOCK_PT).toBe(10);
    expect(decideDirection(9.9, 0)).toBeNull();
    expect(decideDirection(6, 7)).toBeNull();
  });
  it('claims horizontal at 10pt', () => { expect(decideDirection(10, 3)).toBe('h'); expect(decideDirection(-12, 4)).toBe('h'); });
  it('fails vertical early (ties go to parent scroll)', () => {
    expect(decideDirection(2, 10)).toBe('v');
    expect(decideDirection(11, -11)).toBe('v');
  });
  it('is sticky once locked', () => {
    expect(stickyDirection('h', 0, 80)).toBe('h');
    expect(stickyDirection('v', 80, 0)).toBe('v');
    expect(stickyDirection(null, 15, 1)).toBe('h');
  });
});

describe('paging boundaries', () => {
  const W = 400;
  it('tracks the finger between pages', () => { expect(pagerOffset(-100, 1, 3, W)).toBe(-500); });
  it('rubber-bands at first and last instead of wrapping', () => {
    const first = pagerOffset(200, 0, 3, W);
    expect(first).toBeGreaterThan(0); expect(first).toBeLessThan(200);
    const last = pagerOffset(-200, 2, 3, W);
    expect(last).toBeLessThan(-800); expect(last).toBeGreaterThan(-1000);
    expect(Math.abs(rubberBand(10000, W))).toBeLessThan(W);
  });
  it('snaps with momentum, one page max, clamped', () => {
    expect(snapIndex(0, -50, -1500, 3, W)).toBe(1);
    expect(snapIndex(1, -50, 0, 3, W)).toBe(1);
    expect(snapIndex(1, -250, 0, 3, W)).toBe(2);
    expect(snapIndex(0, 300, 3000, 3, W)).toBe(0);
    expect(snapIndex(2, -900, -9000, 3, W)).toBe(2);
    expect(snapIndex(1, 30, 1200, 3, W)).toBe(0);
  });
});

describe('zoom', () => {
  it('anchors the focal point and caps at 4x', () => {
    const z = focalZoom({ scale: 1, tx: 0, ty: 0 }, 50, -40, 50, -40, 2);
    // content point under focal stays under focal: tx + scale*q == f, q = 50
    expect(z.scale).toBe(2); expect(z.tx + z.scale * 50).toBeCloseTo(50); expect(z.ty + z.scale * -40).toBeCloseTo(-40);
    expect(focalZoom({ scale: 3, tx: 0, ty: 0 }, 0, 0, 0, 0, 5).scale).toBe(MAX_ZOOM);
  });
  it('pans while pinching via focal movement', () => {
    const z = focalZoom({ scale: 2, tx: 10, ty: 0 }, 0, 0, 30, 20, 1);
    expect(z).toEqual({ scale: 2, tx: 40, ty: 20 });
  });
  it('clamps pan to the scaled content edges', () => {
    expect(clampPan(500, -500, 2, 400, 600, 400, 300)).toEqual({ tx: 200, ty: 0 });
    expect(clampPan(0, 0, 1, 400, 600, 400, 300)).toEqual({ tx: 0, ty: 0 });
  });
  it('feed resets on release; viewer persists until pinched out', () => {
    const z = { scale: 2.5, tx: 900, ty: 0 };
    expect(releaseZoom('reset', z, 400, 600, 400, 300)).toEqual({ scale: 1, tx: 0, ty: 0, zoomed: false });
    const kept = releaseZoom('persistent', z, 400, 600, 400, 300);
    expect(kept.zoomed).toBe(true); expect(kept.scale).toBe(2.5); expect(kept.tx).toBe(300);
    expect(releaseZoom('persistent', { scale: 0.9, tx: 5, ty: 5 }, 400, 600, 400, 300).zoomed).toBe(false);
  });
});

import { panMoveDecision, parseAspect, pinchTouchDecision, touchDownLock } from '../carouselGestureMath';

describe('production touch lock (pan/pinch decisions)', () => {
  it('waits under 10pt, then locks horizontal and activates', () => {
    expect(panMoveDecision('', 9, 0, 1, false, 3)).toEqual({ lock: '', action: 'none' });
    expect(panMoveDecision('', 10, 2, 1, false, 3)).toEqual({ lock: 'h', action: 'activate' });
  });
  it('fails vertical at 10pt so the parent scroll resumes', () => {
    expect(panMoveDecision('', 1, 10, 1, false, 3)).toEqual({ lock: 'v', action: 'fail' });
    expect(pinchTouchDecision('v', 1, true)).toBe('fail');
  });
  it('never flips once locked', () => {
    expect(panMoveDecision('h', 0, 200, 1, false, 3)).toEqual({ lock: 'h', action: 'none' });
    expect(panMoveDecision('v', 200, 0, 1, false, 3)).toEqual({ lock: 'v', action: 'none' });
    expect(touchDownLock('h', 2)).toBe('h');
  });
  it('resets only at a new touch sequence', () => {
    expect(touchDownLock('h', 1)).toBe('');
    expect(touchDownLock('', 2)).toBe('p');
  });
  it('remaining finger after a pinch never pages when unzoomed; pans when zoomed', () => {
    expect(panMoveDecision('p', 80, 0, 1, false, 3).action).toBe('fail');
    expect(panMoveDecision('p', 80, 0, 1, true, 3).action).toBe('activate');
    expect(panMoveDecision('', 80, 0, 2, false, 3)).toEqual({ lock: 'p', action: 'none' });
  });
  it('single photo: horizontal does not page; pinch still activates', () => {
    expect(panMoveDecision('', 20, 0, 1, false, 1).action).toBe('fail');
    expect(pinchTouchDecision('', 2, true)).toBe('activate');
    expect(pinchTouchDecision('', 2, false)).toBe('fail');
  });
  it('parses authored ratios', () => {
    expect(parseAspect('4:5')).toBeCloseTo(0.8); expect(parseAspect(0.75)).toBe(0.75);
    expect(parseAspect('bogus')).toBeUndefined(); expect(parseAspect(null)).toBeUndefined();
  });
});
