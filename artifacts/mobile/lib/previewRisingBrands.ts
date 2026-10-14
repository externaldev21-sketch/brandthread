/**
 * ?demo=1 preview data for Discover > Brands "Rising this week". Uses the
 * same preview brand cast as the rest of Discover (previewCatalog.ts). Fresh
 * preview gets nothing, so the section stays hidden there.
 */
import { getPreviewCatalog } from './previewCatalog';
import type { RisingBrand } from './risingBrands';

const GROWTH = [184, 126, 92, 71, 58, 44, 37, 29, 22, 15];

export function getPreviewRisingBrands(): RisingBrand[] {
  const seen = new Set<string>();
  const brands: RisingBrand[] = [];
  for (const p of getPreviewCatalog()) {
    if (seen.has(p.sellerId) || brands.length >= GROWTH.length) continue;
    seen.add(p.sellerId);
    brands.push({
      rank: brands.length + 1,
      sellerId: p.sellerId,
      username: null,
      brandName: p.sellerDisplayName,
      logoUrl: p.images[0] ?? null,
      growthPct: GROWTH[brands.length]!,
    });
  }
  return brands;
}
