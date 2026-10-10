import { describe, expect, it } from 'vitest';
import { formatSellerRating } from './sellerRating';

describe('formatSellerRating', () => {
  it('shows one decimal and the review count', () => {
    expect(formatSellerRating({ avgRating: 4.75, totalCount: 23 })).toBe('4.8 (23)');
    expect(formatSellerRating({ avgRating: 5, totalCount: 1 })).toBe('5.0 (1)');
  });
  it('hides the rating for a seller with no reviews', () => {
    expect(formatSellerRating({ avgRating: 0, totalCount: 0 })).toBeNull();
    expect(formatSellerRating(null)).toBeNull();
  });
});
