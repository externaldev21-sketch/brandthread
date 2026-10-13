import { describe, expect, it } from 'vitest';
import {
  UNKNOWN_STOCK_CAP, clampQuantity, showsLimitNote, knownStockLimit, stepQuantity, stepperMax, stockLimitNote,
} from '@/lib/cart/quantityLimit';

describe('knownStockLimit / stepperMax', () => {
  it('uses real stock when known', () => {
    expect(knownStockLimit(3)).toBe(3);
    expect(stepperMax(3)).toBe(3);
    expect(stepperMax(1)).toBe(1);
  });
  it('treats 0 / missing / invalid stock as unknown (service cap, no note)', () => {
    for (const v of [0, -2, undefined, null, Number.NaN, 2.5]) {
      expect(knownStockLimit(v as number | undefined)).toBeNull();
      expect(stepperMax(v as number | undefined)).toBe(UNKNOWN_STOCK_CAP);
    }
  });
});

describe('clampQuantity', () => {
  it('clamps into [min, max]', () => {
    expect(clampQuantity(5, 1, 3)).toBe(3);
    expect(clampQuantity(0, 1, 3)).toBe(1);
    expect(clampQuantity(2, 1, 3)).toBe(2);
  });
  it('never goes below min even if max < min', () => {
    expect(clampQuantity(4, 1, 0)).toBe(1);
  });
});

describe('stepQuantity', () => {
  it('increments below the limit', () => {
    expect(stepQuantity(2, 1, 1, 3)).toEqual({ kind: 'change', next: 3 });
  });
  it('reports at-max instead of changing when + is pressed at the limit', () => {
    expect(stepQuantity(3, 1, 1, 3)).toEqual({ kind: 'at-max', max: 3 });
    expect(stepQuantity(4, 1, 1, 3)).toEqual({ kind: 'at-max', max: 3 });
  });
  it('decrements and stops at min', () => {
    expect(stepQuantity(3, -1, 1, 3)).toEqual({ kind: 'change', next: 2 });
    expect(stepQuantity(1, -1, 1, 3)).toEqual({ kind: 'none' });
  });
});

describe('stockLimitNote', () => {
  it('reads "Only N left"', () => {
    expect(stockLimitNote(2)).toBe('Only 2 left');
  });
});

describe('showsLimitNote', () => {
  it('shows above the low-stock badge threshold only (no duplicate "Only N left")', () => {
    expect(showsLimitNote(5)).toBe(true);
    expect(showsLimitNote(4)).toBe(true);
    expect(showsLimitNote(3)).toBe(false);
    expect(showsLimitNote(1)).toBe(false);
    expect(showsLimitNote(null)).toBe(false);
  });
});
