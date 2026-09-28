import { describe, it, expect } from 'vitest';
import {
  clampCropTransform,
  resolvePixelCropRect,
  normalizeCropRect,
  denormalizeCropRect,
  transformFromNormalizedRect,
  isIdentityCrop,
  centeredDefaultCropRect,
  DEFAULT_CROP_TRANSFORM,
} from '@/lib/mediaCrop';

const RATIO_3_4 = 3 / 4;
const RATIO_9_16 = 9 / 16;

describe('clampCropTransform', () => {
  it('never lets the crop box exceed the source image (min zoom fills the frame)', () => {
    // A 1000x1000 square source cropped to 3:4 at scale 1 must produce a
    // box that fits entirely inside the source with no room to pan.
    const clamped = clampCropTransform(DEFAULT_CROP_TRANSFORM, 1000, 1000, RATIO_3_4);
    expect(clamped.scale).toBe(1);
    expect(clamped.tx).toBe(0);
    expect(clamped.ty).toBe(0);
  });

  it('clamps scale to the [1, 4] range', () => {
    expect(clampCropTransform({ scale: 0.2, tx: 0, ty: 0 }, 1000, 1000, RATIO_3_4).scale).toBe(1);
    expect(clampCropTransform({ scale: 10, tx: 0, ty: 0 }, 1000, 1000, RATIO_3_4).scale).toBe(4);
  });

  it('clamps pan so the box never exits the source bounds', () => {
    const clamped = clampCropTransform({ scale: 2, tx: 100000, ty: 100000 }, 1000, 1000, RATIO_3_4);
    // At scale 2 the box is smaller than the source, so some pan room
    // exists, but it must stay within [-maxTx, maxTx].
    const rect = resolvePixelCropRect(1000, 1000, RATIO_3_4, clamped);
    expect(rect.originX).toBeGreaterThanOrEqual(0);
    expect(rect.originY).toBeGreaterThanOrEqual(0);
    expect(rect.originX + rect.width).toBeLessThanOrEqual(1000);
    expect(rect.originY + rect.height).toBeLessThanOrEqual(1000);
  });
});

describe('resolvePixelCropRect', () => {
  it('produces a centered 3:4 box for a square source at scale 1', () => {
    const rect = resolvePixelCropRect(1000, 1000, RATIO_3_4, DEFAULT_CROP_TRANSFORM);
    expect(rect.width / rect.height).toBeCloseTo(RATIO_3_4, 2);
    // 3:4 is taller than it is wide, so a square source is height-constrained:
    // box height == source height, width shrinks to the ratio.
    expect(rect.height).toBe(1000);
    expect(rect.width).toBe(750); // 1000 * (3/4)
  });

  it('produces a centered 9:16 box for a landscape source at scale 1', () => {
    const rect = resolvePixelCropRect(1920, 1080, RATIO_9_16, DEFAULT_CROP_TRANSFORM);
    expect(rect.width / rect.height).toBeCloseTo(RATIO_9_16, 2);
    expect(rect.height).toBe(1080);
  });

  it('zooming in (scale 2) halves both box dimensions', () => {
    const base = resolvePixelCropRect(1000, 1000, RATIO_3_4, DEFAULT_CROP_TRANSFORM);
    const zoomed = resolvePixelCropRect(1000, 1000, RATIO_3_4, { scale: 2, tx: 0, ty: 0 });
    expect(zoomed.width).toBeCloseTo(base.width / 2, 0);
    expect(zoomed.height).toBeCloseTo(base.height / 2, 0);
  });
});

describe('normalize / denormalize round-trip', () => {
  it('round-trips a pixel rect through normalize -> denormalize exactly', () => {
    const sourceW = 1200, sourceH = 1600;
    const pixelRect = resolvePixelCropRect(sourceW, sourceH, RATIO_3_4, { scale: 1.5, tx: 40, ty: -20 });
    const normalized = normalizeCropRect(pixelRect, sourceW, sourceH);
    const back = denormalizeCropRect(normalized, sourceW, sourceH);
    expect(back.originX).toBeCloseTo(pixelRect.originX, 0);
    expect(back.originY).toBeCloseTo(pixelRect.originY, 0);
    expect(back.width).toBeCloseTo(pixelRect.width, 0);
    expect(back.height).toBeCloseTo(pixelRect.height, 0);
  });

  it('transformFromNormalizedRect re-derives a transform that reproduces the same rect', () => {
    const sourceW = 1200, sourceH = 1600;
    const original = { scale: 1.8, tx: 30, ty: -50 };
    const pixelRect = resolvePixelCropRect(sourceW, sourceH, RATIO_3_4, original);
    const normalized = normalizeCropRect(pixelRect, sourceW, sourceH);

    const rederived = transformFromNormalizedRect(normalized, sourceW, sourceH);
    const rederivedPixelRect = resolvePixelCropRect(sourceW, sourceH, RATIO_3_4, rederived);

    expect(rederivedPixelRect.originX).toBeCloseTo(pixelRect.originX, 0);
    expect(rederivedPixelRect.originY).toBeCloseTo(pixelRect.originY, 0);
    expect(rederivedPixelRect.width).toBeCloseTo(pixelRect.width, 0);
    expect(rederivedPixelRect.height).toBeCloseTo(pixelRect.height, 0);
  });
});

describe('isIdentityCrop', () => {
  it('is true only for scale 1, no pan', () => {
    expect(isIdentityCrop(DEFAULT_CROP_TRANSFORM)).toBe(true);
    expect(isIdentityCrop({ scale: 1.01, tx: 0, ty: 0 })).toBe(false);
    expect(isIdentityCrop({ scale: 1, tx: 1, ty: 0 })).toBe(false);
  });
});

describe('centeredDefaultCropRect', () => {
  it('gives legacy media (no saved crop) a centered 3:4 rect, never 9:16', () => {
    const rect = centeredDefaultCropRect(2000, 1500, RATIO_3_4);
    const pixelRect = denormalizeCropRect(rect, 2000, 1500);
    expect(pixelRect.width / pixelRect.height).toBeCloseTo(RATIO_3_4, 2);
  });
});
