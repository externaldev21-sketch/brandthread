import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CROP_TRANSFORM, centeredDefaultCropRect, normalizeCropRect, resolvePixelCropRect, transformFromNormalizedRect,
} from './mediaCrop';

describe('Edit crop re-opens framed where it was left', () => {
  it('on a landscape source cropped to 3:4 (wider than the target ratio)', () => {
    const sourceW = 4000, sourceH = 3000, ratio = 3 / 4;
    const original = { scale: 1.5, tx: 400, ty: -200 };
    const pixelRect = resolvePixelCropRect(sourceW, sourceH, ratio, original);
    const rederived = transformFromNormalizedRect(normalizeCropRect(pixelRect, sourceW, sourceH), sourceW, sourceH);
    expect(rederived.scale).toBeCloseTo(1.5, 2);
    const again = resolvePixelCropRect(sourceW, sourceH, ratio, rederived);
    expect(again.width).toBeCloseTo(pixelRect.width, -1);
    expect(again.originX).toBeCloseTo(pixelRect.originX, -1);
    expect(again.originY).toBeCloseTo(pixelRect.originY, -1);
  });

  it('an untouched centered default crop re-opens at scale 1, not zoomed in', () => {
    const rect = centeredDefaultCropRect(1920, 1080, 9 / 16);
    const t = transformFromNormalizedRect(rect, 1920, 1080);
    expect(t.scale).toBeCloseTo(DEFAULT_CROP_TRANSFORM.scale, 2);
    expect(t.tx).toBeCloseTo(0, 0);
  });
});
