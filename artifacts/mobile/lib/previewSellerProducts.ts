/**
 * Seeded PREVIEW seller products (?bt_preview=seller&demo=1 —
 * lib/devPreview.ts's isPreviewDemoMode()).
 *
 * services/productService.ts is AsyncStorage-backed and starts empty for
 * every account (see its own header comment) — exactly the "fresh state"
 * the seller Products tab needs by default. This module is the opt-in
 * overlay for `&demo=1`: a small, realistic catalog with a spread of stock
 * levels (healthy, low, out-of-stock, and one product tracked at the
 * product level with no variants) so the stock-editing UI has something
 * real to show and adjust without touching a real account's storage.
 *
 * Mirrors lib/previewActivity.ts's convention: bundled preview poster
 * images stand in for product photos (no real product photography in this
 * seed set), and ids are namespaced (`preview-product-*`) so they can never
 * collide with a real seller's own product ids.
 */
import { Asset } from 'expo-asset';
import type { Product } from '@/services/productTypes';

const POSTER_SOURCES = [
  require('../assets/videos/fashion_runway_01.jpg'),
  require('../assets/videos/fashion_runway_02.jpg'),
  require('../assets/videos/fashion_runway_03.jpg'),
  require('../assets/videos/fashion_runway_04.jpg'),
  require('../assets/videos/fashion_runway_05.jpg'),
];
function posterUri(index: number): string {
  return Asset.fromModule(POSTER_SOURCES[index]).uri;
}

export function isPreviewSellerProductId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('preview-product-');
}

interface SeedVariant {
  size: string;
  color: string;
  qty: number;
}

function buildProduct(opts: {
  index: number;
  name: string;
  category: Product['category'];
  priceCents: number;
  posterIndex: number;
  lowStockThreshold?: number;
  variants?: SeedVariant[];
  /** Omitted entirely (undefined) means this product doesn't track per-variant options at all — a single, product-level stock count. */
  singleStock?: number;
}): Product {
  const id = `preview-product-${opts.index}`;
  const now = new Date(Date.now() - opts.index * 86_400_000).toISOString();
  const media: Product['media'] = [{
    id: `${id}-media-1`,
    type: 'image',
    uri: posterUri(opts.posterIndex),
    isCover: true,
    sortOrder: 0,
    createdAt: now,
  }];

  let options: Product['options'] = [];
  let variants: Product['variants'] = [];
  let totalStock = opts.singleStock ?? 0;

  if (opts.variants && opts.variants.length > 0) {
    const sizeValues = [...new Set(opts.variants.map(v => v.size))];
    const colorValues = [...new Set(opts.variants.map(v => v.color))];
    const sizeOption = { id: `${id}-opt-size`, type: 'size' as const, name: 'Size', sortOrder: 0, values: sizeValues.map(v => ({ id: `${id}-size-${v}`, value: v })) };
    const colorOption = { id: `${id}-opt-color`, type: 'color' as const, name: 'Color', sortOrder: 1, values: colorValues.map(v => ({ id: `${id}-color-${v}`, value: v })) };
    options = colorValues.length > 1 ? [sizeOption, colorOption] : [sizeOption];
    variants = opts.variants.map((v, i) => ({
      id: `${id}-variant-${i}`,
      productId: id,
      title: colorValues.length > 1 ? `${v.size} / ${v.color}` : v.size,
      optionValues: colorValues.length > 1
        ? [{ optionId: sizeOption.id, valueId: `${id}-size-${v.size}` }, { optionId: colorOption.id, valueId: `${id}-color-${v.color}` }]
        : [{ optionId: sizeOption.id, valueId: `${id}-size-${v.size}` }],
      sku: `${id.toUpperCase().replace(/-/g, '_')}_${i}`,
      inventoryQuantity: v.qty,
      reservedQuantity: 0,
      incomingQuantity: 0,
      status: 'active' as const,
      requiresShipping: true,
      taxable: true,
      createdAt: now,
      updatedAt: now,
    }));
    totalStock = variants.reduce((sum, v) => sum + v.inventoryQuantity, 0);
  }

  const lowStockThreshold = opts.lowStockThreshold ?? 5;

  return {
    id,
    sellerId: 'preview-seller',
    name: opts.name,
    description: `${opts.name} — a Brandthread preview product.`,
    category: opts.category,
    tags: [],
    media,
    pricing: { priceCents: opts.priceCents, currency: 'USD' },
    options,
    variants,
    inventory: {
      productId: id,
      trackQuantity: true,
      allowOverselling: false,
      policy: 'deny',
      lowStockThreshold,
      totalStock,
      availableStock: totalStock,
      reservedStock: 0,
      incomingStock: 0,
      locationStock: [],
      variantStock: variants.map(v => ({ variantId: v.id, quantity: v.inventoryQuantity })),
    },
    salesModel: 'pre-made',
    fulfillment: { type: 'seller' },
    manufacturing: { stage: 'none' },
    storeSettings: { status: 'active', collectionIds: [], featuredOnHomepage: false, relatedProductIds: [], seo: { searchVisible: true } },
    totalSales: Math.max(0, 40 - opts.index * 7),
    totalRevenueCents: Math.max(0, 40 - opts.index * 7) * opts.priceCents,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
  };
}

/** A fresh, independent copy each call — callers own their own mutable state. */
export function getPreviewSellerProducts(): Product[] {
  return [
    buildProduct({
      index: 1,
      name: 'Classic Crew Tee',
      category: 'T-shirt',
      priceCents: 3800,
      posterIndex: 0,
      variants: [
        { size: 'S', color: 'Black', qty: 24 },
        { size: 'M', color: 'Black', qty: 31 },
        { size: 'L', color: 'Black', qty: 18 },
      ],
    }),
    buildProduct({
      index: 2,
      name: 'Heavyweight Hoodie',
      category: 'Hoodie',
      priceCents: 7800,
      posterIndex: 1,
      lowStockThreshold: 8,
      variants: [
        { size: 'S', color: 'Grey', qty: 12 },
        { size: 'M', color: 'Grey', qty: 4 },
        { size: 'L', color: 'Grey', qty: 16 },
      ],
    }),
    buildProduct({
      index: 3,
      name: 'Wool Overcoat',
      category: 'Jacket',
      priceCents: 24000,
      posterIndex: 2,
      variants: [
        { size: 'M', color: 'Navy', qty: 0 },
        { size: 'L', color: 'Navy', qty: 0 },
      ],
    }),
    buildProduct({
      index: 4,
      name: 'Relaxed Denim',
      category: 'Denim',
      priceCents: 9200,
      posterIndex: 3,
      lowStockThreshold: 6,
      variants: [
        { size: '30', color: 'Indigo', qty: 22 },
        { size: '32', color: 'Indigo', qty: 3 },
        { size: '34', color: 'Indigo', qty: 9 },
      ],
    }),
    buildProduct({
      index: 5,
      name: 'Studio Sweatpants',
      category: 'Sweatpants',
      priceCents: 5600,
      posterIndex: 4,
      singleStock: 47,
    }),
  ];
}
