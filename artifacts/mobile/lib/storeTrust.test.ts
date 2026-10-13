import { describe, expect, it } from 'vitest';
import { hasDetailRatings, shipsInLabel } from './storeTrust';

describe('shipsInLabel', () => {
  it('reads like the store header chip', () => {
    expect(shipsInLabel(0)).toBe('Ships today');
    expect(shipsInLabel(1)).toBe('Ships in 1 day');
    expect(shipsInLabel(3)).toBe('Ships in 3 days');
  });
  it('shows nothing when the store has no shipping set up', () => {
    expect(shipsInLabel(null)).toBeNull();
    expect(shipsInLabel(undefined)).toBeNull();
    expect(shipsInLabel(-1)).toBeNull();
  });
});

describe('hasDetailRatings', () => {
  it('is true once any review gave a detail rating', () => {
    expect(hasDetailRatings(null)).toBe(false);
    expect(hasDetailRatings({ shipSpeed: { avg: 0, count: 0 }, accuracy: { avg: 0, count: 0 } })).toBe(false);
    expect(hasDetailRatings({ shipSpeed: { avg: 4.5, count: 2 }, accuracy: { avg: 0, count: 0 } })).toBe(true);
  });
});
