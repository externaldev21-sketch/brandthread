import { describe, expect, it } from 'vitest';
import { priceRange, priceStepPath } from './priceHistory';

const NOW = new Date('2026-10-13T00:00:00Z');
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();

describe('priceStepPath', () => {
  it('draws nothing for fewer than two points', () => {
    expect(priceStepPath([], 300, 60, NOW)).toBe('');
    expect(priceStepPath([{ priceCents: 100, at: at(10) }], 300, 60, NOW)).toBe('');
  });

  it('steps down on the day the price changed and runs flat to today', () => {
    const d = priceStepPath([{ priceCents: 22000, at: at(90) }, { priceCents: 19000, at: at(30) }], 300, 60, NOW, 2);
    // Starts at the top (higher price), steps at 2/3 of the width, ends at the bottom, flat to the right edge.
    expect(d).toBe('M0 2 H200 V58 H300');
  });

  it('steps up when the price rose', () => {
    const d = priceStepPath([{ priceCents: 3000, at: at(90) }, { priceCents: 4000, at: at(45) }], 300, 60, NOW, 2);
    expect(d).toBe('M0 58 H150 V2 H300');
  });
});

describe('priceRange', () => {
  it('returns the high and low', () => {
    expect(priceRange([{ priceCents: 5, at: at(1) }, { priceCents: 9, at: at(0) }])).toEqual({ hi: 9, lo: 5 });
    expect(priceRange([])).toBeNull();
  });
});
