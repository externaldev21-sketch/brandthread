/**
 * Item 135 "More from this brand": the preview shelf holds only the same
 * seller's other pieces, never the product itself, and is inert outside the
 * dev-web preview (vitest compiles as a production build).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/previewCatalog', () => ({
  isPreviewCatalogEnabled: () => false,
  getPreviewCatalog: () => [],
  getPreviewCatalogProduct: () => null,
}));
vi.mock('@/lib/devPreview', () => ({ isBuyerDevPreview: () => false, isPreviewDemoMode: () => false }));

import { getPreviewSellerProducts, rankPreviewSameSeller } from '@/lib/previewProducts';

const row = (productId: string, sellerId: string, name: string) => ({
  id: productId, productId, sellerId, name, sellerDisplayName: sellerId === 's1' ? 'Atelier Noire' : 'Other',
  category: 'Outerwear', images: [`${productId}.jpg`], currentPriceCents: 1000, sizes: ['M'], tags: [],
}) as any;

describe('More from this brand (preview)', () => {
  const all = [row('p1', 's1', 'Coat'), row('p2', 's2', 'Jacket'), row('p3', 's1', 'Scarf'), row('p4', 's1', 'Hat')];

  it('lists only the same seller, without the product itself, in catalog order', () => {
    expect(rankPreviewSameSeller(all, 'p1').map(p => p.id)).toEqual(['p3', 'p4']);
    expect(rankPreviewSameSeller(all, 'p1')[0]).toEqual({ id: 'p3', name: 'Scarf', images: ['p3.jpg'], priceCents: 1000, sellerDisplayName: 'Atelier Noire' });
  });

  it('respects the limit and is empty for an unknown product or a seller with one piece', () => {
    expect(rankPreviewSameSeller(all, 'p1', 1).map(p => p.id)).toEqual(['p3']);
    expect(rankPreviewSameSeller(all, 'missing')).toEqual([]);
    expect(rankPreviewSameSeller(all, 'p2')).toEqual([]);
  });

  it('is inert in a production build', () => {
    expect(getPreviewSellerProducts('preview-product-01')).toEqual([]);
  });
});
