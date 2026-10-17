import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  clampOffset,
  clampZoom,
  coverScale,
  cropRectFor,
  maxOffset,
  offsetForFocalZoom,
} from './avatarCrop';

describe('avatarCrop math', () => {
  it('cover scale fits the shorter side to the circle', () => {
    expect(coverScale(4000, 3000, 300)).toBeCloseTo(0.1);
    expect(coverScale(1000, 2000, 500)).toBeCloseTo(0.5);
  });

  it('clamps zoom between cover (1) and MAX_ZOOM', () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(2.5)).toBe(2.5);
    expect(clampZoom(10)).toBe(MAX_ZOOM);
  });

  it('never lets an edge of the image enter the circle', () => {
    // 4000x3000 at cover scale 0.1 is drawn 400x300 behind a 300pt circle.
    expect(maxOffset(4000, 0.1, 300)).toBe(50);
    expect(maxOffset(3000, 0.1, 300)).toBe(0);
    expect(clampOffset(80, 4000, 0.1, 300)).toBe(50);
    expect(clampOffset(-80, 4000, 0.1, 300)).toBe(-50);
    expect(clampOffset(20, 3000, 0.1, 300)).toBe(0);
  });

  it('crops the centred square at zoom 1 with no offset', () => {
    expect(cropRectFor({ imageW: 4000, imageH: 3000, diameter: 300, zoom: 1, tx: 0, ty: 0 }))
      .toEqual({ originX: 500, originY: 0, width: 3000, height: 3000 });
  });

  it('dragging the image right reveals its left side', () => {
    // Max right shift of 50pt at scale 0.1 = 500 source px.
    expect(cropRectFor({ imageW: 4000, imageH: 3000, diameter: 300, zoom: 1, tx: 50, ty: 0 }))
      .toEqual({ originX: 0, originY: 0, width: 3000, height: 3000 });
    // Over-drag is clamped to the same rect.
    expect(cropRectFor({ imageW: 4000, imageH: 3000, diameter: 300, zoom: 1, tx: 999, ty: 0 }))
      .toEqual({ originX: 0, originY: 0, width: 3000, height: 3000 });
  });

  it('zoom shrinks the crop square around the moved centre', () => {
    // zoom 2 → scale 0.2, square side = 300 / 0.2 = 1500 px.
    // ty = -100pt → centre moves 500px down: 1500 + 500 = 2000 → origin 1250.
    expect(cropRectFor({ imageW: 4000, imageH: 3000, diameter: 300, zoom: 2, tx: 0, ty: -100 }))
      .toEqual({ originX: 1250, originY: 1250, width: 1500, height: 1500 });
  });

  it('works for portrait images and max zoom', () => {
    const rect = cropRectFor({ imageW: 1080, imageH: 1920, diameter: 358, zoom: MAX_ZOOM, tx: 0, ty: 0 });
    expect(rect.width).toBe(270);
    expect(rect.height).toBe(270);
    expect(rect.originX).toBe(405);
    expect(rect.originY).toBe(825);
  });

  it('keeps the rect inside the image after rounding', () => {
    const rect = cropRectFor({ imageW: 1001, imageH: 777, diameter: 333, zoom: 1.37, tx: -999, ty: 999 });
    expect(rect.originX).toBeGreaterThanOrEqual(0);
    expect(rect.originY).toBeGreaterThanOrEqual(0);
    expect(rect.originX + rect.width).toBeLessThanOrEqual(1001);
    expect(rect.originY + rect.height).toBeLessThanOrEqual(777);
  });

  it('focal zoom keeps the point under the fingers fixed', () => {
    // A focal point 100pt right of centre, image offset 0: doubling zoom
    // pushes the image left by 100 so that point stays under the fingers.
    expect(offsetForFocalZoom(0, 100, 1, 2)).toBe(-100);
    expect(offsetForFocalZoom(20, 0, 1, 2)).toBe(40);
  });
});
