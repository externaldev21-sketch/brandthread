/**
 * Products a seller can feature before going live (seller-go-live.tsx).
 * Read from the bulk catalog listing because it carries the first image and
 * the lowest price; GET /api/products has neither. Only active, unlocked
 * listings can be shown to buyers in a live.
 *
 * Product photos are stored as private object paths ("/objects/…"), which an
 * <Image> cannot load. `liveProductImageUrl` turns one into the public product
 * photo address (GET /api/v1/public/media/products/:id/:index, routes/
 * public-media.ts — it redirects to a signed URL for ACTIVE products, which is
 * all this picker offers); http(s) URLs pass through untouched.
 */
import type { BulkProduct, BulkProductList } from '@/lib/productBulk';

export interface LiveProductOption {
  id: string;
  name: string;
  imageUrl: string | null;
  priceCents: number;
  totalStock: number;
}

export function liveProductImageUrl(productId: string, image: string | null | undefined, apiBase = ''): string | null {
  if (!image || typeof image !== 'string') return null;
  if (/^(https?:|file:|data:)/i.test(image)) return image;
  if (image.startsWith('/objects/')) {
    return `${apiBase.replace(/\/$/, '')}/api/v1/public/media/products/${encodeURIComponent(productId)}/0`;
  }
  return null;
}

export function toLiveProductOptions(list: BulkProductList | BulkProduct[] | null | undefined, apiBase = ''): LiveProductOption[] {
  const items = Array.isArray(list) ? list : list?.items ?? [];
  return items
    .filter((p) => p.status === 'active' && !p.moderationLocked)
    .map((p) => ({
      id: p.id,
      name: p.name,
      imageUrl: liveProductImageUrl(p.id, p.image, apiBase),
      priceCents: p.minPriceCents ?? 0,
      totalStock: p.totalStock,
    }))
    // In-stock first; the server keeps the newest-first order within each group.
    .sort((a, b) => Number(b.totalStock > 0) - Number(a.totalStock > 0));
}
