/**
 * Preview orders — the buyer order(s) the dev-web preview's seeded Activity
 * rows point at (?bt_preview=buyer|seller, no real account).
 *
 * Seeded order notifications (lib/previewActivity.ts, e.g. "Your order
 * shipped · Sculpted Wool Coat is on its way") target `preview-order-*`
 * ids. With no account the real GET /api/buyer/orders/:id answers 401, so
 * the order screen showed "Could not load order details". This returns the
 * same row shape that endpoint returns, built from the shared preview
 * catalog so the product, brand, price and photo match what the preview shows
 * everywhere else.
 *
 * Gating: `__DEV__` + `isPreviewCatalogEnabled()` (dev only — dead code in production)
 * and only for `preview-order-*` ids; screens use it only when the real
 * request fails, never over real API data.
 */
import type { PreviewCatalogProduct } from './previewCatalog';

// previewCatalog pulls in bundled image assets (expo-asset). It's required
// lazily, only once a preview order is actually requested in a dev build, so
// screens importing this module (e.g. buyer-order-detail) don't load the
// preview asset pool — or break under test runners that can't — otherwise.
function previewCatalogProduct(id: string): PreviewCatalogProduct | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const catalog = require('./previewCatalog') as typeof import('./previewCatalog');
  return catalog.isPreviewCatalogEnabled() ? catalog.getPreviewCatalogProduct(id) : null;
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

export function isPreviewOrderId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('preview-order-');
}

/** A seeded order in GET /api/buyer/orders/:id's shape, or null. */
export function getPreviewBuyerOrder(id: string | null | undefined): Record<string, unknown> | null {
  // Same gate as isPreviewCatalogEnabled (dev builds only), checked before
  // anything is loaded.
  if (!__DEV__ || !isPreviewOrderId(id)) return null;
  if (id !== 'preview-order-01') return null;
  const product = previewCatalogProduct('preview-product-01');
  if (!product) return null;
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  return {
    id,
    orderNumber: 'BT-10428',
    ownerId: product.sellerId,
    sellerDisplayName: product.sellerDisplayName,
    status: 'shipped',
    stripePaymentIntentId: 'pi_preview_order_01',
    items: [{
      productId: product.productId,
      productName: product.name,
      variantLabel: 'Black / M',
      quantity: 1,
      priceCents: product.currentPriceCents,
      imageUrl: product.images[0],
    }],
    shippingAddress: {
      name: 'Jordan Reyes', street: '148 Mercer Street', city: 'New York', state: 'NY', zip: '10012', country: 'US',
    },
    subtotalCents: product.currentPriceCents,
    shippingCents: 0,
    totalCents: product.currentPriceCents,
    trackingNumber: '1Z999AA10123456784',
    carrier: 'UPS',
    trackingStatus: 'in_transit',
    estimatedDelivery: new Date(now + 2 * DAY).toISOString(),
    shippedAt: iso(200 * 60_000), // matches the seeded "Your order shipped" row (200 min ago)
    paidAt: iso(2 * DAY - 2 * 60_000), // captured two minutes after the order was placed
    isCustomerVisible: true,
    createdAt: iso(2 * DAY),
  };
}
