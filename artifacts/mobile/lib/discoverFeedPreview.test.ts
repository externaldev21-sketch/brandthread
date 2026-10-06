import { describe, expect, it } from 'vitest';
import { previewCatalogToDiscoverItems } from '@/lib/discoverFeedPreview';

const row = (id: string, demand: number, images: string[] = ['x.jpg']) => ({
  productId: id, sellerId: `s-${id}`, sellerDisplayName: `Brand ${id}`, name: `Product ${id}`,
  currentPriceCents: 1000, compareAtPriceCents: null, images, category: 'tops', demandCount: demand,
});

describe('previewCatalogToDiscoverItems', () => {
  it('ranks by demand, drops imageless rows and maps the contract fields', () => {
    const items = previewCatalogToDiscoverItems([row('a', 1), row('b', 9), row('c', 5, [])]);
    expect(items.map((i) => i.productId)).toEqual(['b', 'a']);
    expect(items[0]).toMatchObject({ rank: 1, brandId: 's-b', brandName: 'Brand b', productName: 'Product b', priceCents: 1000 });
  });
});
