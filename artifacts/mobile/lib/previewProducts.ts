/**
 * Preview products: the buyer product page's data for the dev-web preview's
 * seeded catalog (?bt_preview=buyer, no real account; lib/previewCatalog.ts).
 *
 * The live preview's "Just Dropped → Sculpted Wool Coat" opens
 * /thread-product-detail?productId=preview-product-01. With no backend
 * catalog row, GET /api/public/products/:id fails, so the page had nothing
 * to render and the whole buy flow stopped there. This builds the same
 * BuyerProduct shape the real adapter produces, from the catalog, so that
 * everything downstream is the real code path:
 *  - size chips, stock and sold-out;
 *  - Add to cart (the local-first cart in services/cartService);
 *  - fly-to-cart and the badge bump;
 *  - Buy now, then the real checkout. Checkout's pay() uses
 *    lib/previewCheckout.ts for these items instead of Stripe.
 *
 * Gating: isPreviewCatalogEnabled(), which is `__DEV__` only and dead code
 * in production. It only applies to `preview-product-*` ids, and the
 * product page uses it only after the real request has failed.
 */
import type { BuyerProduct } from '@/services/cartTypes';
import type { PreviewCatalogProduct } from './previewCatalog';
import { isPreviewDemoMode } from './devPreview';

// previewCatalog pulls in bundled image assets; require it lazily (same
// reason as lib/previewOrders.ts) so importing this module is free.
function catalog(): typeof import('./previewCatalog') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./previewCatalog') as typeof import('./previewCatalog');
}

export function isPreviewProductId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('preview-product-');
}

function previewEnabled(): boolean {
  if (typeof __DEV__ !== 'undefined' && !__DEV__) return false;
  return catalog().isPreviewCatalogEnabled();
}

/** "About this piece" copy + materials for each seeded product (by name). */
const DETAILS: Record<string, { description: string; materials: string; care: string; fit: string }> = {
  'Sculpted Wool Coat': {
    description: 'A single-breasted coat cut from double-faced wool with a sculpted, dropped shoulder and a clean, collarless neckline. Hand-finished seams and concealed snap closures keep the front uninterrupted.',
    materials: '90% virgin wool, 10% cashmere. Lining: 100% cupro.',
    care: 'Dry clean only.',
    fit: 'Relaxed fit. Take your usual size.',
  },
  'Liquid Silver Dress': {
    description: 'A bias-cut slip dress in liquid-finish satin that moves like metal. Adjustable spaghetti straps and a cowl neckline; falls to the ankle.',
    materials: '100% polyester satin with a metallic coating.',
    care: 'Hand wash cold. Do not tumble dry.',
    fit: 'True to size. Bias cut, so it skims the body.',
  },
  'Oversized Tuxedo': {
    description: 'A two-piece tuxedo with an oversized, softly structured jacket, satin peak lapels and wide pleated trousers.',
    materials: '100% wool. Lapels: 100% silk satin.',
    care: 'Dry clean only.',
    fit: 'Oversized fit. Size down for a closer cut.',
  },
  'Ivory Column Set': {
    description: 'A matching column skirt and cropped shell top in heavy crepe, with a side-slit skirt and a concealed back zip.',
    materials: '72% triacetate, 28% polyester crepe.',
    care: 'Dry clean recommended.',
    fit: 'True to size.',
  },
  'Asymmetric Layer Jacket': {
    description: 'A cropped jacket built from layered, asymmetric panels with raw-cut edges and an off-center zip.',
    materials: '100% cotton twill, garment-dyed.',
    care: 'Machine wash cold, inside out. Line dry.',
    fit: 'Boxy, cropped fit.',
  },
  'Draped Hardware Gown': {
    description: 'A floor-length jersey gown draped from a single silver ring at the shoulder, with an open back.',
    materials: '95% viscose, 5% elastane. Hardware: nickel-free brass.',
    care: 'Hand wash cold.',
    fit: 'True to size. Stretch jersey.',
  },
  'Crystal Mesh Top': {
    description: 'A sheer, long-sleeve mesh top scattered with hand-set crystals. Designed for layering.',
    materials: '88% nylon, 12% elastane. Glass crystals.',
    care: 'Hand wash cold. Dry flat.',
    fit: 'Close fit.',
  },
  'Reconstructed Trench': {
    description: 'A classic trench taken apart and rebuilt with a split back, double storm flaps and an oversized belt.',
    materials: '100% cotton gabardine, water-repellent finish.',
    care: 'Dry clean only.',
    fit: 'Oversized fit.',
  },
  'Satin Power Suit': {
    description: 'A double-breasted satin blazer with strong shoulders, paired with high-rise straight trousers.',
    materials: '100% polyester duchess satin. Lining: 100% viscose.',
    care: 'Dry clean only.',
    fit: 'True to size.',
  },
  'Sculpted Silk Gown': {
    description: 'A strapless silk gown with a boned, sculpted bodice and a softly gathered floor-length skirt.',
    materials: '100% silk faille. Boning: polyester.',
    care: 'Dry clean only.',
    fit: 'True to size. Structured bodice.',
  },
  'Leather Ankle Boots': {
    description: 'A pointed-toe ankle boot in supple calfskin leather with a stacked block heel and a side zip closure.',
    materials: '100% calfskin leather upper. Sole: leather with a rubber grip pad.',
    care: 'Wipe clean with a soft, dry cloth. Condition leather regularly.',
    fit: 'True to size.',
  },
};

const RETURNS_POLICY = 'Returns accepted within 14 days of delivery for unworn items with tags attached.';
const CANCEL_POLICY = 'Cancel free of charge until the order ships.';

function handleFor(name: string): string {
  return '@' + name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Pure: a preview catalog row → the product page's BuyerProduct (exported for tests). */
const DEMO_CHEST_CM: Record<string, [number, number]> = { XS: [82, 88], S: [88, 94], M: [94, 100], L: [100, 108], XL: [108, 116] };
function demoSizeChart(sizes: string[]) {
  const rows = sizes.filter((s) => DEMO_CHEST_CM[s]).map((s) => ({ size: s, values: [`${DEMO_CHEST_CM[s][0]}-${DEMO_CHEST_CM[s][1]}`] }));
  return rows.length ? { columns: ['Chest'], unit: 'cm', rows } : null;
}

export function previewBuyerProductFromCatalog(row: PreviewCatalogProduct): BuyerProduct {
  const details = DETAILS[row.name];
  const optionId = 'opt_size';
  // Real stock shape: a spread of counts, the smallest size sold out when
  // there are four or more (so the sold-out chip treatment is real too).
  const variants = row.sizes.map((size, index) => {
    const soldOut = row.sizes.length >= 4 && index === 0;
    const inventory = soldOut ? 0 : index === row.sizes.length - 1 ? 2 : 6 + index * 3;
    return {
      id: `${row.productId}-${size.toLowerCase()}`,
      title: size,
      optionValues: [{ optionId, valueId: `size_${size}` }],
      priceCents: row.currentPriceCents,
      compareAtPriceCents: row.compareAtPriceCents ?? undefined,
      inventoryQuantity: inventory,
      isAvailable: inventory > 0,
      imageUri: row.images[0],
    };
  });
  const description = details
    ? `${details.description}\n\nMaterials: ${details.materials}\nFit: ${details.fit}\nCare: ${details.care}`
    : '';
  return {
    id: row.productId,
    sellerId: row.sellerId,
    sellerName: row.sellerDisplayName,
    sellerHandle: handleFor(row.sellerDisplayName),
    // The seeded preview catalog carries no verification flag of its own
    // (lib/previewCatalog.ts) — every seeded boutique is treated as
    // verified so the dev-web preview exercises the same seller-row badge
    // a real verified seller's product would show. Placeholder for preview
    // data only; the real path (adaptApiProduct above) reads the actual
    // `sellerVerified` the API already computes.
    sellerVerified: true,
    // Real per-product seed value (lib/previewCatalog.ts row.claimedUnits),
    // not invented for the sheet.
    claimedUnits: row.claimedUnits,
    name: row.name,
    description,
    priceCents: row.currentPriceCents,
    compareAtPriceCents: row.compareAtPriceCents ?? undefined,
    imageUris: row.images,
    category: row.category,
    isPreOrder: false,
    cancellationPolicy: CANCEL_POLICY,
    refundPolicy: RETURNS_POLICY,
    options: [{ id: optionId, name: 'Size', values: row.sizes.map(size => ({ id: `size_${size}`, label: size })) }],
    variants,
    isActive: true,
    tags: row.tags,
    sizeChartImageUrl: row.sizeChartImageUrl,
    // &demo=1 only: a seeded chest/waist chart so the size recommendation can be reviewed.
    sizeChart: isPreviewDemoMode() ? demoSizeChart(row.sizes) : null,
  };
}

/** The product page's BuyerProduct for a seeded preview product, or null. */
export function getPreviewBuyerProduct(id: string | null | undefined): BuyerProduct | null {
  if (!isPreviewProductId(id) || !previewEnabled()) return null;
  const row = catalog().getPreviewCatalogProduct(id!);
  return row ? previewBuyerProductFromCatalog(row) : null;
}

/**
 * "You might also like" for a preview product: the same seller's other
 * pieces first, then the same category, then the rest of the catalog, in
 * the related-products row shape ({ id, name, images, priceCents }).
 */
export function getPreviewRelatedProducts(id: string, limit = 4): Array<{ id: string; name: string; images: string[]; priceCents: number; sellerDisplayName: string }> {
  if (!isPreviewProductId(id) || !previewEnabled()) return [];
  return rankPreviewRelated(catalog().getPreviewCatalog(), id, limit);
}

/** Pure ranking behind getPreviewRelatedProducts (exported for tests). */
export function rankPreviewRelated(all: PreviewCatalogProduct[], id: string, limit = 4): Array<{ id: string; name: string; images: string[]; priceCents: number; sellerDisplayName: string }> {
  const self = all.find(p => p.productId === id);
  if (!self) return [];
  const others = all.filter(p => p.productId !== id);
  const ranked = [
    ...others.filter(p => p.sellerId === self.sellerId),
    ...others.filter(p => p.sellerId !== self.sellerId && p.category === self.category),
    ...others.filter(p => p.sellerId !== self.sellerId && p.category !== self.category),
  ];
  return ranked.slice(0, limit).map(p => ({
    id: p.productId, name: p.name, images: p.images, priceCents: p.currentPriceCents, sellerDisplayName: p.sellerDisplayName,
  }));
}
