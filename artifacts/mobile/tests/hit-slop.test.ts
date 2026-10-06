import { describe, expect, it } from 'vitest';
import { minHitSlop } from '@/lib/hitSlop';
import { normalizeSlop } from '../shims/web-hit-slop';

describe('minHitSlop', () => {
  it('pads a small control up to 44pt on both axes', () => {
    expect(minHitSlop({ width: 24, height: 24 })).toEqual({ top: 10, bottom: 10, left: 10, right: 10 });
  });
  it('rounds up so odd shortfalls still reach 44pt', () => {
    const s = minHitSlop({ width: 42, height: 19 });
    expect(42 + s.left! + s.right!).toBeGreaterThanOrEqual(44);
    expect(19 + s.top! + s.bottom!).toBeGreaterThanOrEqual(44);
  });
  it('only pads the axis it is given', () => {
    expect(minHitSlop({ height: 34 })).toEqual({ top: 5, bottom: 5, left: 0, right: 0 });
  });
  it('never returns negative padding for controls already large enough', () => {
    expect(minHitSlop({ width: 120, height: 48 })).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });
});

describe('web hitSlop shim normalizeSlop', () => {
  it('ignores missing or zero slop', () => {
    expect(normalizeSlop(undefined)).toBeNull();
    expect(normalizeSlop(0)).toBeNull();
    expect(normalizeSlop({ top: 0, left: 0 })).toBeNull();
  });
  it('expands a number to every side', () => {
    expect(normalizeSlop(8)).toEqual({ top: 8, bottom: 8, left: 8, right: 8 });
  });
  it('fills missing sides with 0 and clamps negatives', () => {
    expect(normalizeSlop({ top: 6, left: -3 })).toEqual({ top: 6, bottom: 0, left: 0, right: 0 });
  });
});
