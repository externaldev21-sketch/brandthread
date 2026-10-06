/**
 * Demo-mode (&demo=1) trending items for the full-screen Discover pager
 * (components/discover/DiscoverPager.tsx). Maps the shared preview catalog
 * (lib/previewCatalog.ts) onto the discover.feed item contract so the demo
 * shows the same preview brands as Discover/Search/Shop instead of an empty
 * "No trending products" state. Pure — callers gate on demo mode.
 */
import type { PreviewCatalogProduct } from '@/lib/previewCatalog';
import type { DiscoverFeedItem } from '@/components/discover/DiscoverPager';

type CatalogRow = Pick<PreviewCatalogProduct,
  'productId' | 'sellerId' | 'sellerDisplayName' | 'name' | 'currentPriceCents' | 'compareAtPriceCents' | 'images' | 'category' | 'demandCount'>;

export function previewCatalogToDiscoverItems(rows: CatalogRow[]): DiscoverFeedItem[] {
  return [...rows]
    .filter((row) => row.images.length > 0)
    .sort((a, b) => b.demandCount - a.demandCount)
    .map((row, i) => ({
      rank: i + 1,
      productId: row.productId,
      brandId: row.sellerId,
      brandName: row.sellerDisplayName,
      brandVerified: false,
      productName: row.name,
      priceCents: row.currentPriceCents,
      compareAtPriceCents: row.compareAtPriceCents,
      images: row.images,
      category: row.category,
      sellerScore: 0,
    }));
}
