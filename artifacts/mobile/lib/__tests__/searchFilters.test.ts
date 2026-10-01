import { describe, expect, it } from 'vitest';
import { countActiveFilters, filtersToApiOptions, hasValue, priceBucketsFor, toggleValue } from '../searchFilters';
import { swatchFor } from '../colorSwatches';

describe('countActiveFilters', () => {
  it('counts each selected value, one for price, sort and in-stock', () => {
    expect(countActiveFilters({})).toBe(0);
    expect(countActiveFilters({ sizes: ['M', 'L'], colors: ['Black'], inStock: true, minPriceCents: 0, maxPriceCents: 5000, sort: 'newest' })).toBe(6);
    expect(countActiveFilters({ sort: 'relevance' })).toBe(0);
  });
});

describe('toggleValue', () => {
  it('adds, removes case-insensitively and drops empty lists', () => {
    expect(toggleValue(undefined, 'M')).toEqual(['M']);
    expect(toggleValue(['M'], 'L')).toEqual(['M', 'L']);
    expect(toggleValue(['M', 'L'], 'm')).toEqual(['L']);
    expect(toggleValue(['M'], 'M')).toBeUndefined();
    expect(hasValue(['Black'], 'black')).toBe(true);
  });
});

describe('filtersToApiOptions', () => {
  it('omits unset and default values', () => {
    expect(filtersToApiOptions({ sort: 'relevance', sizes: [] })).toEqual({});
    expect(filtersToApiOptions({ sizes: ['M'], brands: ['b1'], inStock: true, maxPriceCents: 5000, sort: 'price_asc' }))
      .toEqual({ size: ['M'], brand: ['b1'], inStock: true, maxPriceCents: 5000, sort: 'price_asc' });
  });
});

describe('priceBucketsFor', () => {
  it('returns all buckets without a range and hides unreachable ones with one', () => {
    expect(priceBucketsFor(null)).toHaveLength(4);
    expect(priceBucketsFor({ minCents: 6000, maxCents: 9000 }).map((b) => b.key)).toEqual(['50-100']);
    expect(priceBucketsFor({ minCents: 2000, maxCents: 30000 })).toHaveLength(4);
  });
});

describe('swatchFor', () => {
  it('maps known colour names and ignores unknown ones', () => {
    expect(swatchFor(' Black ')).toBe('#121214');
    expect(swatchFor('Chartreuse-ish')).toBeNull();
  });
});
