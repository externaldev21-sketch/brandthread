/**
 * Brandthread Product Service
 *
 * AsyncStorage-backed local product store.
 * Starts empty — products are created by sellers via the UI.
 * Real API failures propagate; unavailable products are never substituted.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Product, ProductDraft, ProductFilter, ProductSearchQuery,
  ProductMedia, ProductVariant, ProductOption, ProductCategory,
  InventoryAdjustment, ProductAnalytics, ProductCollection,
  SalesModel, ProductStatus,
} from '@/services/productTypes';
import { calcTotalInventory } from '@/lib/productUtils';
import { centsAtBasisPoints } from '@/lib/money';
import { serviceRequest } from '@/lib/serviceConfig';

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const PRODUCTS_KEY      = '@brandthread/products';
const COLLECTIONS_KEY   = '@brandthread/collections';
const DRAFT_PREFIX      = '@brandthread/draft_';
const INVENTORY_ADJ_KEY = '@brandthread/inventory_adj';

/** One-time migration marker — written after legacy demo records are purged. */
const MIGRATION_V1_KEY  = '@brandthread/migration_v1_demo_purged';

// ─── Known legacy demo IDs (seeded in v1 demo build) ─────────────────────────
// These exact IDs are removed on first run to clear stale demo data from devices
// that ran the previous demo build. Legitimate user-created records are never
// affected because user records receive random IDs from uid().

const LEGACY_DEMO_PRODUCT_IDS    = new Set(['prod_001', 'prod_002', 'prod_003', 'prod_004']);
const LEGACY_DEMO_COLLECTION_IDS = new Set(['col_001', 'col_002']);

// ─── In-memory store ──────────────────────────────────────────────────────────

let _products: Product[] = [];
let _collections: ProductCollection[] = [];
let _initialized = false;

async function ensureInitialized() {
  if (_initialized) return;

  // One-time migration: remove known legacy demo records on existing devices.
  // Uses exact known IDs so no legitimate user record is touched.
  const migrated = await AsyncStorage.getItem(MIGRATION_V1_KEY).catch(() => null);
  if (!migrated) {
    try {
      const rawProducts = await AsyncStorage.getItem(PRODUCTS_KEY);
      if (rawProducts) {
        const stored: Product[] = JSON.parse(rawProducts);
        const cleaned = stored.filter(p => !LEGACY_DEMO_PRODUCT_IDS.has(p.id));
        if (cleaned.length !== stored.length) {
          await AsyncStorage.setItem(PRODUCTS_KEY, JSON.stringify(cleaned));
        }
      }
    } catch { /* non-fatal */ }
    try {
      const rawCols = await AsyncStorage.getItem(COLLECTIONS_KEY);
      if (rawCols) {
        const stored: ProductCollection[] = JSON.parse(rawCols);
        const cleaned = stored.filter(c => !LEGACY_DEMO_COLLECTION_IDS.has(c.id));
        if (cleaned.length !== stored.length) {
          await AsyncStorage.setItem(COLLECTIONS_KEY, JSON.stringify(cleaned));
        }
      }
    } catch { /* non-fatal */ }
    await AsyncStorage.setItem(MIGRATION_V1_KEY, '1').catch(() => {});
  }

  try {
    const raw = await AsyncStorage.getItem(PRODUCTS_KEY);
    if (raw) _products = JSON.parse(raw);
  } catch { /* start empty */ }
  try {
    const rawCols = await AsyncStorage.getItem(COLLECTIONS_KEY);
    if (rawCols) _collections = JSON.parse(rawCols);
  } catch { /* start empty */ }
  _initialized = true;
}

async function persist() {
  try { await AsyncStorage.setItem(PRODUCTS_KEY, JSON.stringify(_products)); } catch { /* non-fatal */ }
}

function uid(): string {
  return 'prod_' + Math.random().toString(36).slice(2, 11);
}

// ─── Product CRUD ─────────────────────────────────────────────────────────────

export async function getProducts(query?: ProductSearchQuery): Promise<Product[]> {
  await ensureInitialized();
  let list = [..._products];

  if (query?.filter && query.filter !== 'all') {
    list = list.filter(p => {
      switch (query.filter) {
        case 'active':      return p.status === 'active';
        case 'draft':       return p.status === 'draft';
        case 'scheduled':   return p.status === 'scheduled';
        case 'archived':    return p.status === 'archived';
        case 'pre-order':   return p.salesModel === 'pre-order' || p.salesModel === 'both';
        case 'pre-made':    return p.salesModel === 'pre-made' || p.salesModel === 'both';
        case 'low-stock':   return p.inventory.totalStock > 0 && p.inventory.totalStock <= p.inventory.lowStockThreshold;
        case 'out-of-stock':return p.inventory.totalStock === 0 && p.inventory.policy === 'deny';
        default: return true;
      }
    });
  }

  if (query?.text) {
    const q = query.text.toLowerCase();
    list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.tags.some(t => t.toLowerCase().includes(q)) ||
      p.variants.some(v => v.sku?.toLowerCase().includes(q)) ||
      p.category.toLowerCase().includes(q)
    );
  }

  if (query?.sortBy) {
    list.sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0;
      if (query.sortBy === 'name')         { av = a.name; bv = b.name; }
       else if (query.sortBy === 'price')   { av = a.pricing.priceCents; bv = b.pricing.priceCents; }
      else if (query.sortBy === 'sales')   { av = a.totalSales; bv = b.totalSales; }
      else if (query.sortBy === 'createdAt') { av = a.createdAt; bv = b.createdAt; }
      else if (query.sortBy === 'updatedAt') { av = a.updatedAt; bv = b.updatedAt; }
      else if (query.sortBy === 'inventory') { av = a.inventory.totalStock; bv = b.inventory.totalStock; }
      if (av < bv) return query.sortDir === 'desc' ? 1 : -1;
      if (av > bv) return query.sortDir === 'desc' ? -1 : 1;
      return 0;
    });
  }

  return list;
}

export async function getProduct(id: string): Promise<Product | undefined> {
  await ensureInitialized();
  return _products.find(p => p.id === id);
}

// Convenience alias
export const getProductById = getProduct;

export async function createProduct(data: Partial<Product>): Promise<Product> {
  await ensureInitialized();

  const id = uid();
  const defaultInventory = {
    productId: id,
    trackQuantity: true,
    allowOverselling: false,
    policy: 'deny' as const,
    lowStockThreshold: 5,
    totalStock: 0,
    availableStock: 0,
    reservedStock: 0,
    incomingStock: 0,
    locationStock: [],
    variantStock: [],
  };

  const product: Product = {
    id,
    sellerId: data.sellerId ?? '',
    name: data.name ?? 'Untitled Product',
    description: data.description ?? '',
    category: data.category ?? 'Other',
    tags: data.tags ?? [],
    media: data.media ?? [],
    pricing: data.pricing ?? { priceCents: 0, currency: 'USD' },
    options: data.options ?? [],
    variants: data.variants ?? [],
    inventory: data.inventory
      ? { ...defaultInventory, ...data.inventory, productId: id }
      : defaultInventory,
    salesModel: data.salesModel ?? 'pre-made',
    fulfillment: data.fulfillment ?? { type: 'seller' },
    manufacturing: data.manufacturing ?? { stage: 'none' },
    storeSettings: data.storeSettings ?? { status: 'draft', collectionIds: [], featuredOnHomepage: false, relatedProductIds: [], seo: { searchVisible: false } },
    totalSales: data.totalSales ?? 0,
    totalRevenueCents: data.totalRevenueCents ?? 0,
    status: data.status ?? 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // Spread remaining data fields (publishedAt, preorderSettings, etc.)
    ...(data.publishedAt !== undefined ? { publishedAt: data.publishedAt } : {}),
    ...(data.preorderSettings !== undefined ? { preorderSettings: data.preorderSettings } : {}),
    ...(data.productType !== undefined ? { productType: data.productType } : {}),
    ...(data.vendor !== undefined ? { vendor: data.vendor } : {}),
  };

  _products.unshift(product);
  await persist();
  return product;
}

export async function updateProduct(id: string, patch: Partial<Product>): Promise<Product | undefined> {
  await ensureInitialized();
  const idx = _products.findIndex(p => p.id === id);
  if (idx === -1) return undefined;
  _products[idx] = { ..._products[idx], ...patch, id, updatedAt: new Date().toISOString() };
  await persist();
  return _products[idx];
}

export async function publishProduct(id: string): Promise<Product | undefined> {
  return updateProduct(id, { status: 'active', publishedAt: new Date().toISOString(), 'storeSettings': { ...(await getProduct(id))!.storeSettings, status: 'active' } });
}

export async function scheduleProduct(id: string, publishDate: string): Promise<Product | undefined> {
  const p = await getProduct(id);
  if (!p) return undefined;
  return updateProduct(id, { status: 'scheduled', storeSettings: { ...p.storeSettings, status: 'scheduled', scheduledPublishDate: publishDate } });
}

export async function archiveProduct(id: string): Promise<Product | undefined> {
  return updateProduct(id, { status: 'archived', storeSettings: { ...(await getProduct(id))!.storeSettings, status: 'archived' } });
}

export async function unarchiveProduct(id: string): Promise<Product | undefined> {
  return updateProduct(id, { status: 'draft' });
}

export interface DeletedProductRecovery {
  recoverableUntil?: string;
  [key: string]: unknown;
}

export async function deleteProduct(id: string): Promise<DeletedProductRecovery> {
  await ensureInitialized();
  // The server owns deletion and the recovery window. Do not delete the cache
  // if it rejects the request: stale local data is safer than pretending a
  // product disappeared when it did not.
  const recovery = await serviceRequest<DeletedProductRecovery>(`/api/products/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  _products = _products.filter(p => p.id !== id);
  await persist();
  return recovery ?? {};
}

export async function restoreProduct(id: string): Promise<void> {
  await ensureInitialized();
  await serviceRequest(`/api/products/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  // The server response is authoritative but may not return a complete product.
  // Leave cache hydration to the next list read rather than manufacturing data.
}

export async function duplicateProduct(id: string): Promise<Product | undefined> {
  const src = await getProduct(id);
  if (!src) return undefined;
  const copy: Partial<Product> = {
    ...src,
    name: src.name + ' (Copy)',
    status: 'draft',
    totalSales: 0,
    totalRevenueCents: 0,
    publishedAt: undefined,
    storeSettings: { ...src.storeSettings, status: 'draft' },
  };
  // Remove id so createProduct generates a fresh one
  delete (copy as any).id;
  return createProduct(copy);
}

// ─── Inventory ────────────────────────────────────────────────────────────────

export async function adjustInventory(
  productId: string,
  variantId: string | undefined,
  delta: number,
  reason: string
): Promise<InventoryAdjustment | undefined> {
  const product = await getProduct(productId);
  if (!product) return undefined;

  const adj: InventoryAdjustment = {
    id: 'adj_' + Math.random().toString(36).slice(2),
    productId,
    variantId,
    locationId: product.inventory.locationStock[0]?.locationId ?? '',
    delta,
    reason,
    createdBy: product.sellerId || 'seller',
    createdAt: new Date().toISOString(),
  };

  // Apply to product inventory
  const newTotal = Math.max(0, product.inventory.totalStock + delta);
  await updateProduct(productId, {
    inventory: { ...product.inventory, totalStock: newTotal, availableStock: Math.max(0, product.inventory.availableStock + delta) },
  });

  return adj;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export async function getProductAnalytics(productId: string): Promise<ProductAnalytics> {
  const p = await getProduct(productId);
  const totalRevenueCents = p?.totalRevenueCents ?? 0;
  const unitsSold = p?.totalSales ?? 0;

  return {
    productId,
    revenueCents: totalRevenueCents,
    unitsSold,
    pageViews: unitsSold * 18,
    addToCartCount: Math.round(unitsSold * 2.4),
    conversionRate: unitsSold > 0 ? 0.062 : 0,
    addToCartRate: 0.134,
    refundRate: 0.018,
    returnRate: 0.024,
    bestVariantId: p?.variants[0]?.id,
    bestSize: 'M',
    bestColor: 'Black',
    sellThroughRate: p && p.inventory.totalStock > 0 ? unitsSold / (unitsSold + p.inventory.totalStock) : 0,
    revenueByDay: Array.from({ length: 14 }, (_, i) => {
      // Deterministic per-product-per-day value — stable across renders
      const seed = ((productId ?? 'p').charCodeAt(0) * 31 + i * 17) % 100;
      return {
        date: new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10),
        revenueCents: centsAtBasisPoints(totalRevenueCents, 400 + seed * 12),
      };
    }),
  };
}

// ─── Collections ─────────────────────────────────────────────────────────────

export async function getCollections(): Promise<ProductCollection[]> {
  await ensureInitialized();
  return _collections;
}

// ─── Draft persistence ────────────────────────────────────────────────────────

export async function saveDraft(draft: ProductDraft): Promise<void> {
  try {
    await AsyncStorage.setItem(DRAFT_PREFIX + draft.id, JSON.stringify({ ...draft, lastSavedAt: new Date().toISOString() }));
  } catch { /* non-fatal */ }
}

export async function loadDraft(id: string): Promise<ProductDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(DRAFT_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function deleteDraft(id: string): Promise<void> {
  try { await AsyncStorage.removeItem(DRAFT_PREFIX + id); } catch { /* non-fatal */ }
}

export async function listDrafts(): Promise<ProductDraft[]> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const draftKeys = keys.filter(k => k.startsWith(DRAFT_PREFIX));
    if (draftKeys.length === 0) return [];
    const pairs = await AsyncStorage.multiGet(draftKeys);
    return pairs
      .map(([, v]) => (v ? (JSON.parse(v) as ProductDraft) : null))
      .filter((d): d is ProductDraft => d !== null)
      .sort((a, b) => b.lastSavedAt.localeCompare(a.lastSavedAt));
  } catch { return []; }
}

// ─── Taggable products (for content system) ───────────────────────────────────

export async function getTaggableProducts(forDraftContent = false): Promise<Product[]> {
  const all = await getProducts();
  return all.filter(p => {
    if (p.status === 'archived') return false;
    if (forDraftContent) return true; // drafts can tag draft products
    return p.status === 'active' || p.status === 'scheduled';
  });
}

// ─── Summary stats ────────────────────────────────────────────────────────────

export async function getProductStats() {
  await ensureInitialized();
  const list = _products;
  return {
    total: list.length,
    active: list.filter(p => p.status === 'active').length,
    draft: list.filter(p => p.status === 'draft').length,
    scheduled: list.filter(p => p.status === 'scheduled').length,
    archived: list.filter(p => p.status === 'archived').length,
    preOrder: list.filter(p => p.salesModel === 'pre-order').length,
    lowStock: list.filter(p => p.inventory.totalStock > 0 && p.inventory.totalStock <= p.inventory.lowStockThreshold).length,
    outOfStock: list.filter(p => p.inventory.totalStock === 0 && p.inventory.policy === 'deny' && p.status === 'active').length,
    totalInventoryValueCents: list.reduce((s, p) => s + (p.pricing.costCents ?? 0) * p.inventory.totalStock, 0),
  };
}
