import { describe, expect, it } from 'vitest';
import {
  DESIGN_EXPORT_FORMATS, DESIGN_EXPORT_SIZES, exportFileName, fitCanvasViewBox,
  getExportFormat, resolveExportPixels,
} from '@/lib/designExportPresets';

describe('resolveExportPixels', () => {
  it('Original is the canvas size exactly', () => {
    expect(resolveExportPixels('original', 4500, 5400)).toEqual({ width: 4500, height: 5400 });
  });

  it('fixed presets ignore the canvas shape', () => {
    expect(resolveExportPixels('product', 4500, 5400)).toEqual({ width: 2000, height: 2000 });
    expect(resolveExportPixels('story', 1080, 1080)).toEqual({ width: 1080, height: 1920 });
    expect(resolveExportPixels('thread', 1080, 1080)).toEqual({ width: 1080, height: 1350 });
  });

  it('long-edge presets keep the canvas aspect ratio', () => {
    expect(resolveExportPixels('web', 4500, 5400)).toEqual({ width: 1000, height: 1200 });
    expect(resolveExportPixels('print', 1080, 1080)).toEqual({ width: 3600, height: 3600 });
    expect(resolveExportPixels('print', 2000, 1000)).toEqual({ width: 3600, height: 1800 });
  });

  it('falls back to a 1080 canvas for missing/invalid dimensions', () => {
    expect(resolveExportPixels('original', 0, Number.NaN)).toEqual({ width: 1080, height: 1080 });
  });

  it('every size yields positive integer pixels', () => {
    for (const size of DESIGN_EXPORT_SIZES) {
      const { width, height } = resolveExportPixels(size.id, 1234, 777);
      expect(Number.isInteger(width) && width > 0, size.id).toBe(true);
      expect(Number.isInteger(height) && height > 0, size.id).toBe(true);
    }
  });
});

describe('fitCanvasViewBox', () => {
  it('is the canvas itself when shapes match', () => {
    expect(fitCanvasViewBox(1080, 1080, 2000, 2000)).toEqual({ x: -0, y: -0, width: 1080, height: 1080 });
  });

  it('letterboxes a square canvas into a tall story frame, centred, never cropping', () => {
    const vb = fitCanvasViewBox(1080, 1080, 1080, 1920);
    expect(vb.width).toBe(1080);
    expect(vb.height).toBeCloseTo(1920);
    expect(vb.x).toBeCloseTo(0);
    expect(vb.y).toBeCloseTo(-420);
    // Whole canvas is inside the box.
    expect(vb.y).toBeLessThanOrEqual(0);
    expect(vb.y + vb.height).toBeGreaterThanOrEqual(1080);
  });

  it('pillarboxes a tall canvas into a square frame', () => {
    const vb = fitCanvasViewBox(4500, 5400, 2000, 2000);
    expect(vb.height).toBeCloseTo(5400);
    expect(vb.width).toBeCloseTo(5400);
    expect(vb.x).toBeCloseTo(-450);
    expect(vb.y).toBeCloseTo(0);
  });
});

describe('formats', () => {
  it('Transparent PNG skips the background; PNG/JPEG/PDF paint it', () => {
    expect(getExportFormat('tpng').includeBackground).toBe(false);
    for (const id of ['png', 'jpg', 'pdf'] as const) expect(getExportFormat(id).includeBackground).toBe(true);
  });

  it('only PDF is native-only (expo-print has no web implementation)', () => {
    expect(DESIGN_EXPORT_FORMATS.filter(f => f.nativeOnly).map(f => f.id)).toEqual(['pdf']);
  });

  it('builds safe file names with the right extension', () => {
    expect(exportFileName('Summer Drop / Tee #1', 'story', getExportFormat('jpg'))).toBe('Summer_Drop_Tee_1_story.jpg');
    expect(exportFileName('', 'original', getExportFormat('tpng'))).toBe('design_original.png');
    expect(exportFileName('Poster', 'print', getExportFormat('pdf'))).toBe('Poster_print.pdf');
  });
});
