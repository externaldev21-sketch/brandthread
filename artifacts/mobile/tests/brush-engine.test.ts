import { describe, it, expect } from 'vitest';
import {
  BRUSH_LIBRARY, BRUSH_KINDS,
  movingAverageSmooth, catmullRomResample,
  buildStrokeStyle, strokeStyleToSvgPath, averageStrokeWidth,
  buildDabs, detectQuickShape, quickShapeToSvgPath,
  StrokeInputPoint,
} from '../lib/brushEngine';
import { DEFAULT_PRESSURE_CURVE } from '../lib/preferencesModel';

function line(n: number, dx = 10): StrokeInputPoint[] {
  return Array.from({ length: n }, (_, i) => ({ x: i * dx, y: 0, t: i * 16 }));
}

describe('brushEngine — brush library', () => {
  it('defines all 8 spec\'d brush kinds', () => {
    expect(BRUSH_KINDS.sort()).toEqual(
      ['pencil', 'ink', 'marker', 'airbrush', 'paint', 'texture', 'spray', 'halftone'].sort(),
    );
    for (const kind of BRUSH_KINDS) {
      expect(BRUSH_LIBRARY[kind].label.length).toBeGreaterThan(0);
    }
  });
});

describe('movingAverageSmooth', () => {
  it('is a no-op at strength 0', () => {
    const pts = line(5);
    expect(movingAverageSmooth(pts, 0)).toEqual(pts);
  });

  it('preserves endpoints and reduces jitter in the middle', () => {
    const pts: StrokeInputPoint[] = [
      { x: 0, y: 0, t: 0 }, { x: 10, y: 50 }, { x: 20, y: -50 }, { x: 30, y: 50 }, { x: 40, y: 0 },
    ].map((p, i) => ({ ...p, t: i * 16 }));
    const smoothed = movingAverageSmooth(pts, 1);
    expect(smoothed[0]).toEqual(pts[0]);
    expect(smoothed[smoothed.length - 1]).toEqual(pts[pts.length - 1]);
    // middle point's jitter should be reduced (closer to 0 than the raw ±50)
    expect(Math.abs(smoothed[2].y)).toBeLessThan(50);
  });
});

describe('catmullRomResample', () => {
  it('passes through original points for < 3 inputs', () => {
    const pts = line(2);
    expect(catmullRomResample(pts)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });

  it('produces more points than the input (upsampling) and ends at the last input point', () => {
    const pts = line(4);
    const out = catmullRomResample(pts, 4);
    expect(out.length).toBeGreaterThan(pts.length);
    expect(out[out.length - 1].x).toBeCloseTo(30, 5);
    expect(out[out.length - 1].y).toBeCloseTo(0, 5);
  });

  it('stays exactly on a straight line for collinear input', () => {
    const pts = line(6);
    const out = catmullRomResample(pts);
    for (const p of out) expect(Math.abs(p.y)).toBeLessThan(1e-6);
  });
});

describe('buildStrokeStyle — pressure + velocity modulation', () => {
  it('returns one style point per input point', () => {
    const pts = line(10);
    const style = buildStrokeStyle(pts, BRUSH_LIBRARY.ink, 20, 1, DEFAULT_PRESSURE_CURVE, 0);
    expect(style.length).toBe(pts.length);
  });

  it('higher pressure produces a wider stroke for a pressure-sensitive brush', () => {
    const ptsLow: StrokeInputPoint[] = [{ x: 0, y: 0, t: 0, force: 0.1 }, { x: 10, y: 0, t: 100, force: 0.1 }];
    const ptsHigh: StrokeInputPoint[] = [{ x: 0, y: 0, t: 0, force: 0.9 }, { x: 10, y: 0, t: 100, force: 0.9 }];
    const styleLow = buildStrokeStyle(ptsLow, BRUSH_LIBRARY.ink, 20, 1, DEFAULT_PRESSURE_CURVE, 0);
    const styleHigh = buildStrokeStyle(ptsHigh, BRUSH_LIBRARY.ink, 20, 1, DEFAULT_PRESSURE_CURVE, 0);
    expect(styleHigh[1].width).toBeGreaterThan(styleLow[1].width);
  });

  it('fast movement tapers width down for a velocity-sensitive brush, never below 25%', () => {
    const slow: StrokeInputPoint[] = [{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 1000 }];
    const fast: StrokeInputPoint[] = [{ x: 0, y: 0, t: 0 }, { x: 1000, y: 0, t: 1 }];
    const brush = BRUSH_LIBRARY.paint; // high velocitySensitivity
    const slowStyle = buildStrokeStyle(slow, brush, 20, 1, DEFAULT_PRESSURE_CURVE, 0);
    const fastStyle = buildStrokeStyle(fast, brush, 20, 1, DEFAULT_PRESSURE_CURVE, 0);
    expect(fastStyle[1].width).toBeLessThanOrEqual(slowStyle[1].width);
    expect(fastStyle[1].width).toBeGreaterThanOrEqual(20 * 0.25 - 0.01);
  });

  it('returns empty for empty input', () => {
    expect(buildStrokeStyle([], BRUSH_LIBRARY.ink, 10, 1, DEFAULT_PRESSURE_CURVE)).toEqual([]);
  });
});

describe('strokeStyleToSvgPath / averageStrokeWidth', () => {
  it('builds a valid M...L... path string', () => {
    const style = buildStrokeStyle(line(5), BRUSH_LIBRARY.ink, 10, 1, DEFAULT_PRESSURE_CURVE, 0);
    const d = strokeStyleToSvgPath(style);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('L');
  });

  it('single point produces a bare M command', () => {
    const style = buildStrokeStyle([{ x: 5, y: 5, t: 0 }], BRUSH_LIBRARY.ink, 10, 1, DEFAULT_PRESSURE_CURVE, 0);
    expect(strokeStyleToSvgPath(style)).toBe('M5.00,5.00');
  });

  it('averageStrokeWidth computes the mean width', () => {
    const pts = [{ x: 0, y: 0, width: 10, opacity: 1 }, { x: 1, y: 1, width: 20, opacity: 1 }];
    expect(averageStrokeWidth(pts)).toBe(15);
  });
});

describe('buildDabs — dab-based brushes', () => {
  it('non-dab brushes (ink) produce no dabs', () => {
    const style = buildStrokeStyle(line(20), BRUSH_LIBRARY.ink, 10, 1, DEFAULT_PRESSURE_CURVE, 0);
    expect(buildDabs(style, BRUSH_LIBRARY.ink)).toEqual([]);
  });

  it('dab-based brushes (spray) produce dabs spaced along the stroke', () => {
    const style = buildStrokeStyle(line(50, 5), BRUSH_LIBRARY.spray, 10, 1, DEFAULT_PRESSURE_CURVE, 0);
    const dabs = buildDabs(style, BRUSH_LIBRARY.spray, 42);
    expect(dabs.length).toBeGreaterThan(0);
    for (const d of dabs) {
      expect(d.radius).toBeGreaterThan(0);
      expect(d.opacity).toBeGreaterThanOrEqual(0);
    }
  });

  it('is deterministic for a given seed', () => {
    const style = buildStrokeStyle(line(50, 5), BRUSH_LIBRARY.spray, 10, 1, DEFAULT_PRESSURE_CURVE, 0);
    const dabsA = buildDabs(style, BRUSH_LIBRARY.spray, 7);
    const dabsB = buildDabs(style, BRUSH_LIBRARY.spray, 7);
    expect(dabsA).toEqual(dabsB);
  });
});

describe('detectQuickShape / quickShapeToSvgPath', () => {
  it('detects a straight line', () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ x: i * 5, y: 0 }));
    expect(detectQuickShape(pts)).toBe('line');
  });

  it('detects a circle', () => {
    const pts = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2;
      return { x: 100 + Math.cos(a) * 50, y: 100 + Math.sin(a) * 50 };
    });
    expect(detectQuickShape(pts)).toBe('circle');
  });

  it('detects a rectangle', () => {
    const pts: { x: number; y: number }[] = [];
    for (let x = 0; x <= 100; x += 10) pts.push({ x, y: 0 });
    for (let y = 0; y <= 100; y += 10) pts.push({ x: 100, y });
    for (let x = 100; x >= 0; x -= 10) pts.push({ x, y: 100 });
    for (let y = 100; y >= 0; y -= 10) pts.push({ x: 0, y });
    expect(detectQuickShape(pts)).toBe('rect');
  });

  it('returns null for a scribble with no clean shape', () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 30 }, { x: 40, y: -10 }, { x: 12, y: 60 }, { x: 80, y: 5 }];
    expect(detectQuickShape(pts)).toBeNull();
  });

  it('quickShapeToSvgPath builds non-empty paths for each detected kind', () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ x: i * 5, y: 0 }));
    expect(quickShapeToSvgPath('line', pts).length).toBeGreaterThan(0);
    expect(quickShapeToSvgPath('rect', pts).length).toBeGreaterThan(0);
    expect(quickShapeToSvgPath('circle', pts).length).toBeGreaterThan(0);
    expect(quickShapeToSvgPath(null, pts)).toBe('');
  });
});
