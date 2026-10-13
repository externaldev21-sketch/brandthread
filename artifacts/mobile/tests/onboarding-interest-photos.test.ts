import { describe, expect, it } from 'vitest';
import { pickFeedPreviewPhotos, pickInterestPhoto } from '@/lib/onboardingInterests';

const product = (imageUri: string | null) => ({ kind: 'product', imageUri });

describe('interest tile photo', () => {
  it('takes the first real public product photo', () => {
    expect(pickInterestPhoto([
      { kind: 'brand', imageUri: 'https://img/brand.jpg' },
      product('/objects/private.jpg'),
      product(null),
      product('https://img/a.jpg'),
      product('https://img/b.jpg'),
    ])).toBe('https://img/a.jpg');
  });

  it('is null when nothing real comes back (plain tile, never a stand-in)', () => {
    expect(pickInterestPhoto([])).toBeNull();
    expect(pickInterestPhoto(undefined)).toBeNull();
    expect(pickInterestPhoto([product('/objects/x.jpg')])).toBeNull();
  });
});

describe('feed preview photos', () => {
  it('takes one per interest in turn, skipping duplicates, up to the cap', () => {
    const a = [product('https://img/a1.jpg'), product('https://img/a2.jpg'), product('https://img/a3.jpg')];
    const b = [product('https://img/a1.jpg'), product('https://img/b2.jpg')];
    expect(pickFeedPreviewPhotos([a, b], 4)).toEqual([
      'https://img/a1.jpg', 'https://img/a2.jpg', 'https://img/b2.jpg', 'https://img/a3.jpg',
    ]);
  });

  it('is empty when no interest finds anything', () => {
    expect(pickFeedPreviewPhotos([[], null, undefined])).toEqual([]);
  });
});
