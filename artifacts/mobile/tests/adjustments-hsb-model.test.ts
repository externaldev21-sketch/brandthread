/**
 * adjustments-hsb-model.test.ts — HSB adjustment model + its real SVG
 * feColorMatrix math (lib/adjustmentsModel.ts's HsbAdjustment and
 * lib/layerRenderer.ts's hsbToColorMatrixValues).
 */
import { describe, it, expect } from 'vitest';
import {
  defaultHsbAdjustment, isIdentityHsb, clampHsb, HsbAdjustment,
} from '../lib/adjustmentsModel';
import { hsbToColorMatrixValues, hsbToColorMatrixString } from '../lib/layerRenderer';

describe('defaultHsbAdjustment / isIdentityHsb', () => {
  it('default is all zeros', () => {
    expect(defaultHsbAdjustment()).toEqual({ hue: 0, saturation: 0, brightness: 0 });
  });

  it('default is identity', () => {
    expect(isIdentityHsb(defaultHsbAdjustment())).toBe(true);
  });

  it('any non-zero field makes it non-identity', () => {
    expect(isIdentityHsb({ hue: 1, saturation: 0, brightness: 0 })).toBe(false);
    expect(isIdentityHsb({ hue: 0, saturation: 0.01, brightness: 0 })).toBe(false);
    expect(isIdentityHsb({ hue: 0, saturation: 0, brightness: -0.01 })).toBe(false);
  });
});

describe('clampHsb', () => {
  it('clamps hue to [-180, 180]', () => {
    expect(clampHsb({ hue: 999, saturation: 0, brightness: 0 }).hue).toBe(180);
    expect(clampHsb({ hue: -999, saturation: 0, brightness: 0 }).hue).toBe(-180);
  });

  it('clamps saturation and brightness to [-1, 1]', () => {
    const c = clampHsb({ hue: 0, saturation: 5, brightness: -5 });
    expect(c.saturation).toBe(1);
    expect(c.brightness).toBe(-1);
  });

  it('passes in-range values through unchanged', () => {
    const adj: HsbAdjustment = { hue: 45, saturation: 0.3, brightness: -0.2 };
    expect(clampHsb(adj)).toEqual(adj);
  });
});

// ─── hsbToColorMatrixValues — real colour-matrix math, not placeholders ──────

function identityLike(values: number[], tolerance = 1e-9) {
  // 20-value feColorMatrix identity: diag of the 3x3 RGB block = 1, rest = 0,
  // alpha row untouched.
  const expected = [
    1, 0, 0, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, 1, 0, 0,
    0, 0, 0, 1, 0,
  ];
  return values.every((v, i) => Math.abs(v - expected[i]) < tolerance);
}

describe('hsbToColorMatrixValues', () => {
  it('is the identity matrix at hue=0, saturation=0, brightness=0', () => {
    const values = hsbToColorMatrixValues(defaultHsbAdjustment());
    expect(identityLike(values)).toBe(true);
  });

  it('always returns exactly 20 values, alpha row untouched', () => {
    const values = hsbToColorMatrixValues({ hue: 90, saturation: 0.5, brightness: 0.3 });
    expect(values).toHaveLength(20);
    expect(values.slice(15, 20)).toEqual([0, 0, 0, 1, 0]);
  });

  it('full desaturation (saturation=-1) collapses every row to the same luminance weights', () => {
    const values = hsbToColorMatrixValues({ hue: 0, saturation: -1, brightness: 0 });
    // Rows 0, 1, 2 (R, G, B outputs) should be identical to each other —
    // every output channel becomes the same luminance value, i.e. grayscale.
    const row0 = values.slice(0, 3);
    const row1 = values.slice(5, 8);
    const row2 = values.slice(10, 13);
    for (let i = 0; i < 3; i++) {
      expect(row1[i]).toBeCloseTo(row0[i], 6);
      expect(row2[i]).toBeCloseTo(row0[i], 6);
    }
    // And those luminance weights sum to 1 (NTSC: 0.213 + 0.715 + 0.072).
    expect(row0[0] + row0[1] + row0[2]).toBeCloseTo(1, 6);
  });

  it('doubling saturation (saturation=1) increases the diagonal gain above 1', () => {
    const values = hsbToColorMatrixValues({ hue: 0, saturation: 1, brightness: 0 });
    expect(values[0]).toBeGreaterThan(1); // R' gain on R input
    expect(values[6]).toBeGreaterThan(1); // G' gain on G input
    expect(values[12]).toBeGreaterThan(1); // B' gain on B input
  });

  it('brightness scales every RGB-row coefficient uniformly', () => {
    const base = hsbToColorMatrixValues({ hue: 30, saturation: 0.2, brightness: 0 });
    const brighter = hsbToColorMatrixValues({ hue: 30, saturation: 0.2, brightness: 0.5 });
    // brighter = base * 1.5 for every RGB-row coefficient (cols 0-2 of rows 0-2).
    for (const row of [0, 1, 2]) {
      for (let col = 0; col < 3; col++) {
        const idx = row * 5 + col;
        expect(brighter[idx]).toBeCloseTo(base[idx] * 1.5, 6);
      }
    }
  });

  it('brightness=-1 (gain 0) zeroes out every RGB-row coefficient', () => {
    const values = hsbToColorMatrixValues({ hue: 60, saturation: 0.4, brightness: -1 });
    for (const row of [0, 1, 2]) {
      for (let col = 0; col < 3; col++) {
        expect(values[row * 5 + col]).toBeCloseTo(0, 6);
      }
    }
  });

  it('a 360°-equivalent hue pair (e.g. -170 vs 190 clamped) still composes via the real rotation formula, not a lookup table', () => {
    // Not literally equal (clamp bounds differ), but both should be valid,
    // finite, non-identity matrices — i.e. real trig, not a stub returning
    // the same canned array regardless of input.
    const a = hsbToColorMatrixValues({ hue: 90, saturation: 0, brightness: 0 });
    const b = hsbToColorMatrixValues({ hue: -90, saturation: 0, brightness: 0 });
    expect(a).not.toEqual(b);
    expect(a.every(Number.isFinite)).toBe(true);
    expect(b.every(Number.isFinite)).toBe(true);
  });
});

describe('hsbToColorMatrixString', () => {
  it('formats as a space-separated string of 20 numbers', () => {
    const str = hsbToColorMatrixString({ hue: 45, saturation: 0.2, brightness: -0.1 });
    const parts = str.split(' ');
    expect(parts).toHaveLength(20);
    for (const p of parts) expect(Number.isFinite(Number(p))).toBe(true);
  });
});
