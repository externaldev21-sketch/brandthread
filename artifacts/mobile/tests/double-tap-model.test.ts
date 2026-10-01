/**
 * double-tap-model.test.ts — unit coverage for lib/doubleTapModel.ts, which
 * drives design-canvas.tsx's double-tap-to-edit-text gesture.
 */
import { describe, it, expect } from 'vitest';
import { isDoubleTap, isPointInTransformBounds } from '../lib/doubleTapModel';
import type { DesignTransform } from '../services/designTypes';

function makeTransform(overrides: Partial<DesignTransform> = {}): DesignTransform {
  return { x: 100, y: 100, width: 200, height: 80, rotation: 0, scaleX: 1, scaleY: 1, ...overrides };
}

describe('isDoubleTap', () => {
  const MAX_MS = 300;
  const MAX_DIST = 30;

  it('is false for the very first tap (no prior tap)', () => {
    expect(isDoubleTap(null, { t: 1000, lx: 10, ly: 10 }, MAX_MS, MAX_DIST)).toBe(false);
  });

  it('is true for two taps close in time and position', () => {
    const last = { t: 1000, lx: 50, ly: 50 };
    const current = { t: 1000 + 150, lx: 52, ly: 48 };
    expect(isDoubleTap(last, current, MAX_MS, MAX_DIST)).toBe(true);
  });

  it('is false when the second tap arrives too late', () => {
    const last = { t: 1000, lx: 50, ly: 50 };
    const current = { t: 1000 + 301, lx: 50, ly: 50 };
    expect(isDoubleTap(last, current, MAX_MS, MAX_DIST)).toBe(false);
  });

  it('is false when the second tap lands too far away', () => {
    const last = { t: 1000, lx: 50, ly: 50 };
    const current = { t: 1000 + 100, lx: 90, ly: 50 }; // 40px away > 30px max
    expect(isDoubleTap(last, current, MAX_MS, MAX_DIST)).toBe(false);
  });

  it('is exactly at the distance boundary → false (strict less-than)', () => {
    const last = { t: 1000, lx: 0, ly: 0 };
    const current = { t: 1000 + 50, lx: MAX_DIST, ly: 0 }; // distance === MAX_DIST
    expect(isDoubleTap(last, current, MAX_MS, MAX_DIST)).toBe(false);
  });

  it('is false for a negative/out-of-order timestamp delta (defensive)', () => {
    const last = { t: 2000, lx: 50, ly: 50 };
    const current = { t: 1000, lx: 50, ly: 50 }; // current before last — malformed input
    expect(isDoubleTap(last, current, MAX_MS, MAX_DIST)).toBe(false);
  });
});

describe('isPointInTransformBounds', () => {
  const t = makeTransform({ x: 100, y: 100, width: 200, height: 80 });

  it('is true for a point inside the bounds', () => {
    expect(isPointInTransformBounds(150, 130, t)).toBe(true);
  });

  it('is true exactly on an edge (inclusive)', () => {
    expect(isPointInTransformBounds(100, 100, t)).toBe(true);
    expect(isPointInTransformBounds(300, 180, t)).toBe(true);
  });

  it('is false for a point outside the bounds', () => {
    expect(isPointInTransformBounds(50, 130, t)).toBe(false);
    expect(isPointInTransformBounds(350, 130, t)).toBe(false);
    expect(isPointInTransformBounds(150, 50, t)).toBe(false);
    expect(isPointInTransformBounds(150, 250, t)).toBe(false);
  });
});
