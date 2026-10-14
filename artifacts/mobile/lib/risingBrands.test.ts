import { describe, expect, it } from 'vitest';
import { RISING_MIN_TO_SHOW, risingBrandsToShow, risingSubline, type RisingBrand } from './risingBrands';

const b = (rank: number, growthPct = 50): RisingBrand => ({
  rank, sellerId: `s${rank}`, username: null, brandName: `Brand ${rank}`, logoUrl: null, growthPct,
});

describe('risingBrandsToShow', () => {
  it('hides the section when fewer than 3 brands qualify', () => {
    expect(RISING_MIN_TO_SHOW).toBe(3);
    expect(risingBrandsToShow(undefined)).toEqual([]);
    expect(risingBrandsToShow([])).toEqual([]);
    expect(risingBrandsToShow([b(1), b(2)])).toEqual([]);
    expect(risingBrandsToShow([b(1), b(2), b(3, 0)])).toEqual([]);
  });

  it('shows the list as ranked once 3 or more qualify', () => {
    expect(risingBrandsToShow([b(1), b(2), b(3)]).map((x) => x.rank)).toEqual([1, 2, 3]);
  });
});

describe('risingSubline', () => {
  it('shows the percent only', () => {
    expect(risingSubline(42)).toBe('+42% orders');
    expect(risingSubline(1250)).toBe('+1,250% orders');
  });
});
