import { describe, expect, it } from 'vitest';
import { layoutSeriesPoints, smoothPath } from './svgSmoothPath';

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
