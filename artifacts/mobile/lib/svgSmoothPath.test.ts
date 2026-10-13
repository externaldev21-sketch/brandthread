import { describe, expect, it } from 'vitest';
import { layoutSeriesPoints, monotonePath, smoothPath } from './svgSmoothPath';

describe('smoothPath', () => {
  it('returns an empty string for fewer than 2 points', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([{ x: 0, y: 0 }])).toBe('');
  });

  it('draws a straight line for exactly 2 points', () => {
    expect(smoothPath([{ x: 0, y: 10 }, { x: 20, y: 0 }])).toBe('M0,10 L20,0');
  });

  it('starts at the first point and ends at the last for 3+ points', () => {
    const path = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]);
    expect(path.startsWith('M0,0')).toBe(true);
    expect(path).toContain('20,0');
  });

  it('never overshoots a segment\'s endpoints (no dip below a zero baseline)', () => {
    // y grows downward: 100 is the $0 baseline. A spike next to flat zeros
    // used to pull the neighbouring control points below the baseline.
    const pts = [{ x: 0, y: 100 }, { x: 10, y: 100 }, { x: 20, y: 0 }, { x: 30, y: 100 }, { x: 40, y: 100 }];
    const ys = [...smoothPath(pts).matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]));
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100);
    }
  });
});

describe('layoutSeriesPoints', () => {
  it('returns no points for an empty series or zero width', () => {
    expect(layoutSeriesPoints([], 100, 40)).toEqual([]);
    expect(layoutSeriesPoints([1, 2], 0, 40)).toEqual([]);
  });

  it('spaces points evenly across the full width', () => {
    const points = layoutSeriesPoints([0, 5, 10], 100, 40);
    expect(points).toHaveLength(3);
    expect(points[0].x).toBe(0);
    expect(points[1].x).toBe(50);
    expect(points[2].x).toBe(100);
  });

  it('maps the max value near the top and the min near the bottom, within padding', () => {
    const points = layoutSeriesPoints([0, 10], 100, 40);
    expect(points[1].y).toBeLessThan(points[0].y);
    expect(points[0].y).toBeLessThanOrEqual(40);
    expect(points[1].y).toBeGreaterThanOrEqual(0);
  });

  it('renders a flat, centered baseline for an all-zero series (new-seller empty state)', () => {
    const points = layoutSeriesPoints([0, 0, 0, 0], 90, 40);
    const ys = points.map((p) => p.y);
    expect(new Set(ys).size).toBe(1);
  });

  it('centers a single-value series horizontally', () => {
    const points = layoutSeriesPoints([5], 100, 40);
    expect(points).toHaveLength(1);
    expect(points[0].x).toBe(50);
    // A single positive value is normalized against [0, value], so it lands
    // at the top padding line (the "max" position), not an arbitrary guess.
    expect(points[0].y).toBeCloseTo(40 * 0.08, 5);
  });
});

/** Samples every cubic segment of an "M x,y C … " path (or a 2-point "L" path) and returns the sampled y values. */
function sampledYs(d: string): number[] {
  const nums = (d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
  if (d.includes(' L')) return [nums[1], nums[3]];
  let y0 = nums[1];
  const ys: number[] = [y0];
  for (let i = 2; i + 5 < nums.length; i += 6) {
    const c1y = nums[i + 1];
    const c2y = nums[i + 3];
    const y1 = nums[i + 5];
    for (let k = 1; k <= 40; k++) {
      const t = k / 40;
      const u = 1 - t;
      ys.push(u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1);
    }
    y0 = y1;
  }
  return ys;
}

describe('monotonePath', () => {
  const series = [
    [0, 0, 0, 0, 120, 0, 0, 340, 0, 0, 0],
    [0, 500, 0],
    [10, 40, 25, 60, 5, 5, 90, 0],
    [300, 280, 120, 460, 200, 620, 90],
  ];
  for (const values of series) {
    it(`never leaves [min, max] of the data: ${values.join(',')}`, () => {
      const points = layoutSeriesPoints(values, 358, 168);
      const ys = sampledYs(monotonePath(points));
      const minY = Math.min(...points.map((p) => p.y));
      const maxY = Math.max(...points.map((p) => p.y));
      expect(ys.length).toBeGreaterThan(points.length);
      for (const y of ys) {
        expect(y).toBeGreaterThanOrEqual(minY - 1e-9);
        expect(y).toBeLessThanOrEqual(maxY + 1e-9);
      }
    });
  }

  it('passes through every data point and stays flat across a run of zeros', () => {
    const points = layoutSeriesPoints([0, 0, 0, 80, 0], 400, 100);
    const d = monotonePath(points);
    for (const p of points) expect(d).toContain(`${p.x},${p.y}`);
    // Segments 0→1 and 1→2 are the flat zero run: 2 segments × 40 samples + the start.
    for (const y of sampledYs(d).slice(0, 81)) expect(y).toBeCloseTo(points[0].y, 9);
  });

  it('is needed: the Catmull-Rom smoothPath overshoots below the baseline here', () => {
    const points = layoutSeriesPoints([0, 0, 0, 120, 0, 0], 358, 168);
    const baselineY = Math.max(...points.map((p) => p.y));
    expect(Math.max(...sampledYs(smoothPath(points)))).toBeGreaterThan(baselineY + 0.5);
  });
});
