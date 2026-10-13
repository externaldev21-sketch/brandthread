/** Item 138: reviews with photos come first, each group keeping server order. */
import { describe, expect, it } from 'vitest';
import { orderPhotoFirst } from '@/lib/reviewOrder';

describe('orderPhotoFirst', () => {
  it('moves photo reviews ahead without reordering within either group', () => {
    const reviews = [
      { id: 'a', photos: [] },
      { id: 'b', photos: ['1.jpg'] },
      { id: 'c' },
      { id: 'd', photos: ['2.jpg', '3.jpg'] },
      { id: 'e', photos: null },
    ];
    expect(orderPhotoFirst(reviews).map(r => r.id)).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  it('does not mutate the input', () => {
    const reviews = [{ id: 'a' }, { id: 'b', photos: ['x'] }];
    orderPhotoFirst(reviews);
    expect(reviews.map(r => r.id)).toEqual(['a', 'b']);
  });
});
