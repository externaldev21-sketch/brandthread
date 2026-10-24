import { describe, expect, it } from 'vitest';
import { computeCanvasFit, displayToLogical } from './canvasFit';

describe('computeCanvasFit', () => {
  it('aspect-fits a square design into a tall stage with one uniform scale', () => {
    // The audited web case: 1080×1080 logical in a ~365×643 area used to
    // stretch to 0.338 × 0.595. It must now be 0.338 on both axes.
    const fit = computeCanvasFit({ stageW: 365, stageH: 643, logicalW: 1080, logicalH: 1080 });
    expect(fit.scale).toBeCloseTo(365 / 1080, 6);
    expect(fit.width).toBeCloseTo(365, 6);
    expect(fit.height).toBeCloseTo(365, 6);
    expect(fit.width / fit.height).toBeCloseTo(1, 6);
    // Centred vertically
    expect(fit.offsetX).toBeCloseTo(0, 6);
    expect(fit.offsetY).toBeCloseTo((643 - 365) / 2, 6);
  });

  it('is height-bound for a wide stage', () => {
    const fit = computeCanvasFit({ stageW: 800, stageH: 400, logicalW: 1080, logicalH: 1350 });
    expect(fit.scale).toBeCloseTo(400 / 1350, 6);
    expect(fit.height).toBeCloseTo(400, 6);
    expect(fit.width).toBeCloseTo(1080 * (400 / 1350), 6);
    expect(fit.offsetX).toBeCloseTo((800 - fit.width) / 2, 6);
    expect(fit.offsetY).toBeCloseTo(0, 6);
  });

  it('preserves the logical aspect ratio exactly', () => {
    const fit = computeCanvasFit({ stageW: 390, stageH: 600, logicalW: 1080, logicalH: 1920 });
    expect(fit.width / fit.height).toBeCloseTo(1080 / 1920, 6);
  });

  it('reserves inset space and centres inside the remaining area', () => {
    const fit = computeCanvasFit({
      stageW: 400, stageH: 700, logicalW: 1000, logicalH: 1000,
      insets: { left: 50, right: 10, top: 40, bottom: 10 },
    });
    // avail = 340 × 650 → width-bound
    expect(fit.scale).toBeCloseTo(0.34, 6);
    expect(fit.offsetX).toBeCloseTo(50, 6);
    expect(fit.offsetY).toBeCloseTo(40 + (650 - 340) / 2, 6);
    // Never covers the reserved left rail or top bar
    expect(fit.offsetX).toBeGreaterThanOrEqual(50);
    expect(fit.offsetY).toBeGreaterThanOrEqual(40);
    expect(fit.offsetX + fit.width).toBeLessThanOrEqual(400 - 10 + 1e-9);
  });

  it('returns an empty fit for an unmeasured stage or zero-sized design', () => {
    expect(computeCanvasFit({ stageW: 0, stageH: 600, logicalW: 1080, logicalH: 1080 }).scale).toBe(0);
    expect(computeCanvasFit({ stageW: 300, stageH: 600, logicalW: 0, logicalH: 1080 }).width).toBe(0);
    expect(computeCanvasFit({
      stageW: 40, stageH: 600, logicalW: 1080, logicalH: 1080, insets: { left: 30, right: 20 },
    }).scale).toBe(0);
  });

  it('maps artboard-local display points back to logical pixels uniformly', () => {
    const fit = computeCanvasFit({ stageW: 540, stageH: 900, logicalW: 1080, logicalH: 1080 });
    expect(displayToLogical(fit, 270, 135)).toEqual({ x: 540, y: 270 });
  });
});
