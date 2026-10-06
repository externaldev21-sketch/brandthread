/**
 * Seller-side "Preview as buyer" + signed-out preview product helpers.
 *
 * - The seller's own draft / archived product is served by
 *   GET /api/public/products/:id to its owner only, flagged
 *   `previewOnly: true` (api-server/src/lib/productPreviewAccess.ts).
 * - A product that exists only in this device's product store (a signed-out
 *   web preview save, or a seeded `&demo=1` product) has no server row, so
 *   the buyer page builds it from the stored product instead
 *   (`localPreview=1`).
 * Either way the buyer page shows it as a preview and does not sell it.
 */

import type { BuyerProduct, BuyerProductOption, BuyerProductVariant } from '@/services/cartTypes';
import type { Product } from '@/services/productTypes';

const SEEDED_PREFIX = 'preview-product-';

/** A seeded `&demo=1` seller product (lib/previewSellerProducts.ts ids). */
export function isSeededPreviewProduct(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(SEEDED_PREFIX);
}

/**
 * What the signed-out preview's Products tab lists: only products the
 * seller saved on this device — never the seeded demo catalog.
 */
export function localPreviewSaves(list: readonly Product[]): Product[] {
  return list.filter((p) => !isSeededPreviewProduct(p.id));
}

/** Where "Preview as buyer" goes for this product. */
export function previewAsBuyerHref(
  productId: string,
  opts: { signedIn: boolean },
): string {
  const local = !opts.signedIn || isSeededPreviewProduct(productId);
  return `/buyer-product-detail?productId=${encodeURIComponent(productId)}${local ? '&localPreview=1' : ''}`;
}

/** True when an API product row is the owner's not-yet-buyable preview. */
export function isOwnerPreviewRow(row: unknown): boolean {
  return typeof row === 'object' && row !== null && (row as { previewOnly?: unknown }).previewOnly === true;
}

function mediaUris(p: Product): string[] {
  return [...(p.media ?? [])]
    .filter((m) => m.type === 'image' && !!m.uri)
    .sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.sortOrder - b.sortOrder)
    .map((m) => (m.useCutout && m.cutoutUri ? m.cutoutUri : m.uri));
}

/** A product from the device's product store → the buyer page's BuyerProduct. */
export function sellerProductToBuyerProduct(p: Product, sellerName = 'Your store'): BuyerProduct {
  const imageUris = mediaUris(p);
  const options: BuyerProductOption[] = [...(p.options ?? [])]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((o) => ({
      id: o.id,
      name: o.name,
      values: o.values.map((v) => ({ id: v.id, label: v.label ?? v.value, ...(v.colorHex ? { colorHex: v.colorHex } : {}) })),
    }));
  const basePrice = p.pricing?.priceCents ?? 0;
  const variants: BuyerProductVariant[] = (p.variants ?? []).length > 0
    ? p.variants.map((v) => ({
      id: v.id,
      title: v.title || 'Default',
      optionValues: v.optionValues ?? [],
      priceCents: v.priceCents ?? basePrice,
      compareAtPriceCents: v.compareAtPriceCents ?? p.pricing?.compareAtPriceCents,
      inventoryQuantity: v.inventoryQuantity ?? 0,
      isAvailable: (v.inventoryQuantity ?? 0) > 0,
      imageUri: imageUris[0],
    }))
    : [{
      id: `${p.id}-default`,
      title: 'Default',
      optionValues: [],
      priceCents: basePrice,
      compareAtPriceCents: p.pricing?.compareAtPriceCents,
      inventoryQuantity: p.inventory?.totalStock ?? 0,
      isAvailable: (p.inventory?.totalStock ?? 0) > 0,
      imageUri: imageUris[0],
    }];
  return {
    id: p.id,
    sellerId: p.sellerId || 'preview-seller',
    sellerName: p.vendor?.trim() || sellerName,
    sellerHandle: '',
    name: p.name || 'Untitled product',
    description: p.description ?? '',
    priceCents: basePrice,
    compareAtPriceCents: p.pricing?.compareAtPriceCents,
    imageUris,
    category: p.category ?? 'apparel',
    isPreOrder: p.salesModel === 'pre-order',
    preOrderClosingDate: p.preorderSettings?.closeDate,
    preOrderEstShipDate: p.preorderSettings?.estimatedShippingDate,
    // Same policy lines the buyer page shows for a live product.
    cancellationPolicy: 'All sales final. Returns accepted only for damaged or incorrect items.',
    refundPolicy: 'Contact the seller within 7 days of delivery to start a return.',
    options,
    variants,
    isActive: p.status === 'active',
    tags: p.tags ?? [],
    sizeChartImageUrl: p.sizeChartImageUrl ?? null,
  };
}
