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
 * The demo cast (demo=1 only) also covers the delivery guarantee: buyer
 * orders mid-transit, delivered, pre-order, auto-refunded and partially
 * refunded, and seller orders with a deadline countdown
 * (lib/previewDeliveryOrders.ts).
 *
 * Gating: `__DEV__` + `isPreviewCatalogEnabled()` (dev only — dead code in production)
 * and only for `preview-order-*` ids; screens use it only when the real
 * request fails, never over real API data.
 */
import type { PreviewCatalogProduct } from './previewCatalog';
import { isPreviewDemoMode } from './devPreview';
import { buildDemoBuyerOrders, buildDemoSellerOrders, isPreviewSellerOrderId } from './previewDeliveryOrders';

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

// Orders placed in this preview session through the real checkout
// (lib/previewCheckout.ts placePreviewOrder). Kept in memory and mirrored to
// sessionStorage so "View order" still works after a reload of the tab.
// Never persisted beyond the tab, and dev builds only.
const PLACED_KEY = 'bt:preview-orders:v1';
const placed = new Map<string, Record<string, unknown>>();

function readPlaced(): void {
  if (placed.size > 0) return;
  try {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(PLACED_KEY) : null;
    const rows = raw ? JSON.parse(raw) : [];
    if (Array.isArray(rows)) for (const row of rows) if (row && typeof row.id === 'string') placed.set(row.id, row);
  } catch { /* storage unavailable: memory only */ }
}

/** Records a preview-checkout order in GET /api/buyer/orders/:id's shape. */
export function recordPreviewOrder(order: Record<string, unknown> & { id: string }): void {
  if (!__DEV__ || !isPreviewOrderId(order.id)) return;
  readPlaced();
  placed.set(order.id, order);
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(PLACED_KEY, JSON.stringify([...placed.values()]));
  } catch { /* memory only */ }
}

/** A seeded or preview-checkout order in GET /api/buyer/orders/:id's shape, or null. */
export function getPreviewBuyerOrder(id: string | null | undefined): Record<string, unknown> | null {
  // Same gate as isPreviewCatalogEnabled (dev builds only), checked before
  // anything is loaded.
  if (!__DEV__ || !isPreviewOrderId(id)) return null;
  readPlaced();
  const placedOrder = placed.get(id!);
  if (placedOrder) return placedOrder;
  // The seeded orders (the Activity feed's "Your order shipped" row and the
  // delivery-guarantee cast) are part of the demo cast, not a fresh account's
  // real history, so they only show under the explicit demo=1 opt-in. An
  // order actually PLACED this session (the `placed` map above) always shows.
  if (!isPreviewDemoMode()) return null;
  return demoBuyerOrders().find(o => o.id === id) ?? null;
}

function demoBuyerOrders(): Record<string, unknown>[] {
  return buildDemoBuyerOrders(previewCatalogProduct);
}

/** The buyer's Orders list in the preview (GET /api/buyer/orders shape). Empty unless demo=1. */
export function getPreviewBuyerOrders(): Record<string, unknown>[] {
  if (!__DEV__ || !isPreviewDemoMode()) return [];
  readPlaced();
  return [...placed.values(), ...demoBuyerOrders()];
}

/** Seller orders with delivery-guarantee countdowns (GET /api/orders shape). Empty unless demo=1. */
export function getPreviewSellerOrders(): Record<string, unknown>[] {
  if (!__DEV__ || !isPreviewDemoMode()) return [];
  return buildDemoSellerOrders();
}

export function getPreviewSellerOrder(id: string | null | undefined): Record<string, unknown> | null {
  if (!__DEV__ || !isPreviewSellerOrderId(id) || !isPreviewDemoMode()) return null;
  return buildDemoSellerOrders().find(o => o.id === id) ?? null;
}
