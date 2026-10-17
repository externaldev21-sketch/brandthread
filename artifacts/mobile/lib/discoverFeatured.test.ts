import { describe, expect, it } from 'vitest';
import { featuredThreadTiles, mergeFeaturedBrands } from './discoverFeatured';

describe('mergeFeaturedBrands', () => {
  it('puts admin picks first, then paid slots, without duplicates', () => {
    const merged = mergeFeaturedBrands(
      [
        { userId: 'b1', label: "Editor's pick", name: 'One', imageUrl: 'https://x/1.png', verified: true },
        { userId: 'b2', label: null, name: 'Two' },
      ],
      [
        { slotId: 's1', sellerId: 'b2', name: 'Two (paid)', imageUrl: null, verified: false },
        { slotId: 's2', sellerId: 'b3', name: 'Three', imageUrl: null, verified: false },
      ],
    );
    expect(merged.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    expect(merged[0]).toEqual({ id: 'b1', name: 'One', verified: true, imageUri: 'https://x/1.png', followersLabel: "Editor's pick" });
    expect(merged[1].followersLabel).toBe('Featured');
    expect(merged[1].name).toBe('Two');
  });

  it('handles missing inputs', () => {
    expect(mergeFeaturedBrands(undefined, null)).toEqual([]);
  });
});

describe('featuredThreadTiles', () => {
  it('maps picks to tiles with a default label', () => {
    expect(featuredThreadTiles([
      { postId: 'p1', label: null, caption: '  hi ', thumbnailUrl: 'https://x/p.jpg' },
      { postId: 'p1', label: 'dup', caption: null },
      { postId: 'p2', label: 'Fit of the week', caption: null, thumbnailUrl: null },
    ])).toEqual([
      { postId: 'p1', label: 'Featured', caption: 'hi', imageUri: 'https://x/p.jpg' },
      { postId: 'p2', label: 'Fit of the week', caption: null, imageUri: undefined },
    ]);
  });
});
