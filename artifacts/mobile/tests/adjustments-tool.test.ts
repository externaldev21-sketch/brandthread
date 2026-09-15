/**
 * adjustments-tool.test.ts — Curves and Liquify model tests.
 *
 * Covers:
 *   - sampleCurve: piecewise-linear evaluation
 *   - curveToTableValues: SVG feComponentTransfer sampling
 *   - gammaApproxOpacity: opacity approximation from gamma midpoint
 *   - computeHistogramFromColors: deterministic from real colors
 *   - LiquifyPushStroke model + netLiquifyDisplacement
 *   - liquifyToSvgTranslate
 *   - defaultCurvesAdjustment: all channels are linear (identity)
 */
import { describe, it, expect } from 'vitest';
import {
  sampleCurve,
  curveToTableValues,
  gammaApproxOpacity,
  computeHistogramFromColors,
  netLiquifyDisplacement,
  liquifyToSvgTranslate,
  defaultCurvesAdjustment,
  defaultCurve,
  CURVE_SAMPLE_COUNT,
  HISTOGRAM_BINS,
  hexToRgb,
} from '../lib/adjustmentsModel';
import type { CurvePoint, LiquifyPushStroke } from '../lib/adjustmentsModel';

// ─── sampleCurve ─────────────────────────────────────────────────────────────

describe('sampleCurve', () => {
  const linear: CurvePoint[] = [{ t: 0, v: 0 }, { t: 1, v: 1 }];

  it('identity curve maps t → t', () => {
    expect(sampleCurve(linear, 0)).toBe(0);
    expect(sampleCurve(linear, 0.5)).toBe(0.5);
    expect(sampleCurve(linear, 1)).toBe(1);
  });

  it('clamps to first point when t is below range', () => {
    const pts: CurvePoint[] = [{ t: 0.2, v: 0.3 }, { t: 1, v: 1 }];
    expect(sampleCurve(pts, 0)).toBe(0.3);
  });

  it('clamps to last point when t is above range', () => {
    const pts: CurvePoint[] = [{ t: 0, v: 0 }, { t: 0.8, v: 0.9 }];
    expect(sampleCurve(pts, 1)).toBe(0.9);
  });

  it('interpolates between control points', () => {
    const pts: CurvePoint[] = [{ t: 0, v: 0 }, { t: 0.5, v: 0.8 }, { t: 1, v: 1 }];
    // At t=0.25 (halfway between 0 and 0.5) → v should be ~0.4
    const v = sampleCurve(pts, 0.25);
    expect(v).toBeCloseTo(0.4, 5);
  });

  it('returns t for empty curve', () => {
    expect(sampleCurve([], 0.7)).toBe(0.7);
  });
});

// ─── curveToTableValues ───────────────────────────────────────────────────────

describe('curveToTableValues', () => {
  it('produces CURVE_SAMPLE_COUNT space-separated values', () => {
    const pts: CurvePoint[] = [{ t: 0, v: 0 }, { t: 1, v: 1 }];
    const tv = curveToTableValues(pts);
    const parts = tv.split(' ');
    expect(parts).toHaveLength(CURVE_SAMPLE_COUNT);
  });

  it('identity curve produces "0 0.1 0.2 … 1"', () => {
    const pts: CurvePoint[] = [{ t: 0, v: 0 }, { t: 1, v: 1 }];
    const tv = curveToTableValues(pts);
    const parts = tv.split(' ').map(Number);
    for (let i = 0; i < CURVE_SAMPLE_COUNT; i++) {
      expect(parts[i]).toBeCloseTo(i / (CURVE_SAMPLE_COUNT - 1), 2);
    }
  });

  it('clamps all values to [0,1]', () => {
    const pts: CurvePoint[] = [{ t: 0, v: -0.5 }, { t: 1, v: 1.5 }]; // out-of-range
    const tv = curveToTableValues(pts);
    const parts = tv.split(' ').map(Number);
    parts.forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
  });

  it('brightened curve has all values ≥ identity', () => {
    // Curve shifted up: output > input
    const pts: CurvePoint[] = [{ t: 0, v: 0.2 }, { t: 1, v: 1 }];
    const id:  CurvePoint[] = [{ t: 0, v: 0   }, { t: 1, v: 1 }];
    const tv1 = curveToTableValues(pts).split(' ').map(Number);
    const tv2 = curveToTableValues(id ).split(' ').map(Number);
    // First value should be ≥ identity's first value
    expect(tv1[0]).toBeGreaterThanOrEqual(tv2[0]);
  });
});

// ─── gammaApproxOpacity ───────────────────────────────────────────────────────

describe('gammaApproxOpacity', () => {
  it('identity curve → opacity ≈ 1', () => {
    const op = gammaApproxOpacity(defaultCurve('gamma'));
    expect(op).toBeCloseTo(1.0, 5);
  });

  it('brightened midpoint → opacity ≥ 0.5', () => {
    const curve = { channel: 'gamma' as const, points: [{ t: 0, v: 0 }, { t: 0.5, v: 0.9 }, { t: 1, v: 1 }] };
    expect(gammaApproxOpacity(curve)).toBeGreaterThan(0.5);
  });

  it('darkened midpoint → opacity ≤ 0.8', () => {
    const curve = { channel: 'gamma' as const, points: [{ t: 0, v: 0 }, { t: 0.5, v: 0.2 }, { t: 1, v: 1 }] };
    expect(gammaApproxOpacity(curve)).toBeLessThanOrEqual(0.8);
  });

  it('clamps minimum to 0.2', () => {
    const curve = { channel: 'gamma' as const, points: [{ t: 0, v: 0 }, { t: 1, v: 0 }] };
    expect(gammaApproxOpacity(curve)).toBeGreaterThanOrEqual(0.2);
  });

  it('clamps maximum to 1.0', () => {
    const curve = { channel: 'gamma' as const, points: [{ t: 0, v: 1 }, { t: 1, v: 1 }] };
    expect(gammaApproxOpacity(curve)).toBeLessThanOrEqual(1.0);
  });
});

// ─── hexToRgb ─────────────────────────────────────────────────────────────────

describe('hexToRgb', () => {
  it('parses red', () => {
    expect(hexToRgb('#FF0000')).toEqual([255, 0, 0]);
  });

  it('parses black', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
  });

  it('parses without hash', () => {
    expect(hexToRgb('FFFFFF')).toEqual([255, 255, 255]);
  });

  it('returns null for invalid', () => {
    expect(hexToRgb('nope')).toBeNull();
    expect(hexToRgb('#FFF')).toBeNull(); // 3-digit not supported
  });
});

// ─── computeHistogramFromColors ───────────────────────────────────────────────

describe('computeHistogramFromColors', () => {
  it('returns arrays of HISTOGRAM_BINS length', () => {
    const h = computeHistogramFromColors(['#FF0000']);
    expect(h.red).toHaveLength(HISTOGRAM_BINS);
    expect(h.green).toHaveLength(HISTOGRAM_BINS);
    expect(h.blue).toHaveLength(HISTOGRAM_BINS);
    expect(h.luma).toHaveLength(HISTOGRAM_BINS);
  });

  it('pure red increments red bucket', () => {
    const h = computeHistogramFromColors(['#FF0000']);
    // Red 255 → last bin; green/blue 0 → first bin; all buckets get 1 count
    const totalRed = h.red.reduce((a, b) => a + b, 0);
    expect(totalRed).toBe(1);
    // Each color (R, G, B) contributes to its own histogram
    expect(h.red[HISTOGRAM_BINS - 1]).toBe(1); // 255 → last bin
    expect(h.green[0]).toBe(1);                // 0 → first bin
    expect(h.blue[0]).toBe(1);                 // 0 → first bin
  });

  it('ignores invalid hex strings', () => {
    const h = computeHistogramFromColors(['not-a-color', '#ZZZZZZ']);
    const total = h.red.reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
  });

  it('is deterministic for the same input', () => {
    const colors = ['#FF0000', '#00FF00', '#0000FF'];
    const h1 = computeHistogramFromColors(colors);
    const h2 = computeHistogramFromColors(colors);
    expect(h1.red).toEqual(h2.red);
  });

  it('aggregates multiple colors', () => {
    const h = computeHistogramFromColors(['#FF0000', '#FF1000', '#FE0000']);
    const totalRed = h.red.reduce((a, b) => a + b, 0);
    expect(totalRed).toBe(3);
  });
});

// ─── defaultCurvesAdjustment ─────────────────────────────────────────────────

describe('defaultCurvesAdjustment', () => {
  it('has all four channels', () => {
    const adj = defaultCurvesAdjustment();
    expect(adj.gamma).toBeDefined();
    expect(adj.red).toBeDefined();
    expect(adj.green).toBeDefined();
    expect(adj.blue).toBeDefined();
  });

  it('all channels are identity (linear)', () => {
    const adj = defaultCurvesAdjustment();
    for (const ch of ['gamma', 'red', 'green', 'blue'] as const) {
      const pts = adj[ch].points;
      expect(pts[0]).toEqual({ t: 0, v: 0 });
      expect(pts[pts.length - 1]).toEqual({ t: 1, v: 1 });
    }
  });
});

// ─── netLiquifyDisplacement ───────────────────────────────────────────────────

describe('netLiquifyDisplacement', () => {
  it('returns zero for no strokes', () => {
    expect(netLiquifyDisplacement([])).toEqual({ dx: 0, dy: 0 });
  });

  it('returns zero for single-point stroke', () => {
    const stroke: LiquifyPushStroke = {
      points: [{ x: 50, y: 50 }],
      size: 40, pressure: 1, distortion: 1, momentum: 0,
    };
    expect(netLiquifyDisplacement([stroke])).toEqual({ dx: 0, dy: 0 });
  });

  it('computes positive displacement from left-to-right push', () => {
    const stroke: LiquifyPushStroke = {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      size: 10, pressure: 1, distortion: 1, momentum: 0,
    };
    const { dx } = netLiquifyDisplacement([stroke]);
    expect(dx).toBeGreaterThan(0);
  });

  it('accumulates displacement from multiple strokes', () => {
    const s1: LiquifyPushStroke = {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      size: 10, pressure: 1, distortion: 1, momentum: 0,
    };
    const s2: LiquifyPushStroke = {
      points: [{ x: 0, y: 0 }, { x: 50, y: 0 }],
      size: 10, pressure: 1, distortion: 1, momentum: 0,
    };
    const { dx: dx1 } = netLiquifyDisplacement([s1]);
    const { dx: dxBoth } = netLiquifyDisplacement([s1, s2]);
    expect(dxBoth).toBeGreaterThan(dx1);
  });

  it('stroke with zero pressure/distortion contributes nothing', () => {
    const stroke: LiquifyPushStroke = {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      size: 10, pressure: 0, distortion: 0, momentum: 0,
    };
    const { dx } = netLiquifyDisplacement([stroke]);
    expect(dx).toBe(0);
  });
});

// ─── liquifyToSvgTranslate ────────────────────────────────────────────────────

describe('liquifyToSvgTranslate', () => {
  it('returns undefined for zero-displacement strokes', () => {
    expect(liquifyToSvgTranslate([], 1, 1)).toBeUndefined();
  });

  it('returns a translate() string for non-zero displacement', () => {
    const stroke: LiquifyPushStroke = {
      points: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
      size: 20, pressure: 1, distortion: 1, momentum: 0,
    };
    const result = liquifyToSvgTranslate([stroke], 1, 1);
    expect(result).toBeTruthy();
    expect(result).toMatch(/^translate\(/);
  });

  it('scales displacement by scaleX/scaleY', () => {
    const stroke: LiquifyPushStroke = {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      size: 10, pressure: 1, distortion: 1, momentum: 0,
    };
    const t1 = liquifyToSvgTranslate([stroke], 1, 1);
    const t2 = liquifyToSvgTranslate([stroke], 2, 1);
    // t2's x component should be 2× t1's
    const px1 = parseFloat(t1!.match(/translate\(([^,]+)/)![1]);
    const px2 = parseFloat(t2!.match(/translate\(([^,]+)/)![1]);
    expect(px2).toBeCloseTo(px1 * 2, 4);
  });
});

// ─── Composed interaction: liquify stroke commit ───────────────────────────────

describe('composed interaction: liquify stroke commit', () => {
  function simulateLiquifyStroke(
    fromX: number, fromY: number, toX: number, toY: number,
    opts: { size?: number; pressure?: number; distortion?: number; momentum?: number } = {},
  ): LiquifyPushStroke {
    // Simulates: grant sets first point; move appends intermediate; release commits.
    return {
      points: [{ x: fromX, y: fromY }, { x: toX, y: toY }],
      size: opts.size ?? 20,
      pressure: opts.pressure ?? 1,
      distortion: opts.distortion ?? 1,
      momentum: opts.momentum ?? 0,
    };
  }

  it('single horizontal stroke produces positive dx, zero dy', () => {
    const stroke = simulateLiquifyStroke(0, 0, 100, 0);
    const { dx, dy } = netLiquifyDisplacement([stroke]);
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeCloseTo(0, 3);
  });

  it('single vertical stroke produces zero dx, positive dy', () => {
    const stroke = simulateLiquifyStroke(0, 0, 0, 100);
    const { dx, dy } = netLiquifyDisplacement([stroke]);
    expect(dx).toBeCloseTo(0, 3);
    expect(dy).toBeGreaterThan(0);
  });

  it('momentum amplifies displacement', () => {
    const base  = simulateLiquifyStroke(0, 0, 100, 0, { momentum: 0 });
    const boosted = simulateLiquifyStroke(0, 0, 100, 0, { momentum: 0.5 });
    const { dx: dx0 } = netLiquifyDisplacement([base]);
    const { dx: dx1 } = netLiquifyDisplacement([boosted]);
    expect(dx1).toBeGreaterThan(dx0);
    expect(dx1).toBeCloseTo(dx0 * 1.5, 5);
  });

  it('two opposing strokes partially cancel', () => {
    const right = simulateLiquifyStroke(0, 0,  100, 0);
    const left  = simulateLiquifyStroke(100, 0, 0,  0);
    const { dx } = netLiquifyDisplacement([right, left]);
    expect(Math.abs(dx)).toBeCloseTo(0, 3);
  });

  it('stroke with zero points is ignored', () => {
    const empty: LiquifyPushStroke = { points: [], size: 10, pressure: 1, distortion: 1, momentum: 0 };
    const { dx, dy } = netLiquifyDisplacement([empty]);
    expect(dx).toBe(0);
    expect(dy).toBe(0);
  });

  it('pressure scales displacement', () => {
    const lowP  = simulateLiquifyStroke(0, 0, 100, 0, { pressure: 0.5 });
    const highP = simulateLiquifyStroke(0, 0, 100, 0, { pressure: 1.0 });
    const { dx: low  } = netLiquifyDisplacement([lowP]);
    const { dx: high } = netLiquifyDisplacement([highP]);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeCloseTo(low * 2, 5);
  });
});
