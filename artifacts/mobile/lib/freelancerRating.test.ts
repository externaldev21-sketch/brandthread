import { describe, expect, it } from 'vitest';
import { ratingLabel, reviewCountLabel, tenthsToStars } from './freelancer';

describe('freelancer rating helpers', () => {
  it('formats the rating and the review count', () => {
    expect(ratingLabel(45)).toBe('4.5');
    expect(ratingLabel(0)).toBeNull();
    expect(reviewCountLabel(0)).toBe('Rating');
    expect(reviewCountLabel(undefined)).toBe('Rating');
    expect(reviewCountLabel(1)).toBe('1 review');
    expect(reviewCountLabel(12)).toBe('12 reviews');
  });

  it('maps a stored rating back to whole stars for the picker', () => {
    expect(tenthsToStars(null)).toBe(0);
    expect(tenthsToStars(40)).toBe(4);
    expect(tenthsToStars(35)).toBe(4);
    expect(tenthsToStars(10)).toBe(1);
    expect(tenthsToStars(50)).toBe(5);
  });
});
