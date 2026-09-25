import { describe, expect, it } from 'vitest';
import {
  LOGO_STITCH_LEAD_IN,
  ThreadPathBuilder,
  logoStitchThread,
  progressThread,
  weaveThread,
  welcomeThread,
} from './threadGeometry';

describe('ThreadPathBuilder', () => {
  it('measures straight segments exactly', () => {
    const g = new ThreadPathBuilder().moveTo(0, 0).lineTo(30, 40).lineTo(30, 100).build();
    expect(g.length).toBeCloseTo(110, 5);
    expect(g.d).toBe('M0,0 L30,40 L30,100');
  });

  it('measures a cubic close to its true arc length', () => {
    // A cubic with collinear control points is a straight line of length 100.
    const g = new ThreadPathBuilder().moveTo(0, 0).cubicTo(25, 0, 75, 0, 100, 0).build();
    expect(g.length).toBeCloseTo(100, 3);
  });

  it('produces monotonic arc-length samples from 0 to 1 for worklet interpolation', () => {
    const g = welcomeThread(390, 200);
    const { t, x, y } = g.samples;
    expect(t.length).toBe(x.length);
    expect(t.length).toBe(y.length);
    expect(t.length).toBeLessThanOrEqual(48);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBe(1);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
  });
});

describe('thread shapes', () => {
  it('progress thread has one stitch node per step, landing exactly on each', () => {
    const g = progressThread(300, 16, 9);
    expect(g.marks).toHaveLength(9);
    expect(g.marks[0]).toBe(0);
    expect(g.marks[8]).toBeCloseTo(1, 6);
    for (let i = 1; i < g.marks.length; i++) expect(g.marks[i]).toBeGreaterThan(g.marks[i - 1]);
    // Nodes are evenly spaced horizontally on the centre line.
    expect(g.markPoints[0]).toEqual({ x: 3, y: 8 });
    expect(g.markPoints[8].x).toBeCloseTo(297, 6);
  });

  it('weave mirrors for back navigation', () => {
    const fwd = weaveThread(300, 120, 1);
    const back = weaveThread(300, 120, -1);
    expect(back.length).toBeCloseTo(fwd.length, 6);
    expect(back.samples.x[0]).toBeCloseTo(300 - fwd.samples.x[0], 6);
  });

  it('logo stitch ties off at the waist of the mark inside the lead-in canvas', () => {
    const size = 100;
    const g = logoStitchThread(size);
    const ox = LOGO_STITCH_LEAD_IN * size;
    expect(g.marks).toHaveLength(2);
    expect(g.markPoints[1]).toEqual({ x: 29.5 + ox, y: 52 });
    // Nothing is drawn left of the canvas (native SVG would clip it).
    expect(Math.min(...g.samples.x)).toBeGreaterThanOrEqual(0);
  });

  it('degenerate sizes never produce zero or NaN lengths', () => {
    for (const g of [welcomeThread(0, 0), progressThread(0, 0, 1), weaveThread(0, 0), logoStitchThread(0)]) {
      expect(Number.isFinite(g.length)).toBe(true);
      expect(g.length).toBeGreaterThan(0);
    }
  });
});
