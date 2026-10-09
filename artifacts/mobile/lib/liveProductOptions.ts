/**
 * Products a seller can feature before going live (seller-go-live.tsx).
 * Read from the bulk catalog listing because it carries the first image and
 * the lowest price; GET /api/products has neither. Only active, unlocked
 * listings can be shown to buyers in a live.
 */
import type { BulkProduct, BulkProductList } from '@/lib/productBulk';

export interface LiveProductOption {
  id: string;
  name: string;
  imageUrl: string | null;
  priceCents: number;
  totalStock: number;
}

export function toLiveProductOptions(list: BulkProductList | BulkProduct[] | null | undefined): LiveProductOption[] {
  const items = Array.isArray(list) ? list : list?.items ?? [];
  return items
    .filter((p) => p.status === 'active' && !p.moderationLocked)
    .map((p) => ({
      id: p.id,
      name: p.name,
      imageUrl: p.image,
      priceCents: p.minPriceCents ?? 0,
      totalStock: p.totalStock,
    }))
    // In-stock first; the server keeps the newest-first order within each group.
    .sort((a, b) => Number(b.totalStock > 0) - Number(a.totalStock > 0));
}
