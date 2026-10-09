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
import { hasServiceToken, serviceRequest, serviceUploadProductImage } from '@/lib/serviceConfig';
import {
  collectLocalImageUris, draftFromServer, mergeDrafts, timeOf, withRemoteImageUris,
  type DraftSyncMetaMap, type ServerDraftRow,
} from '@/lib/productDraftSync';

// ─── Demo preview overlay (?bt_preview=seller&demo=1) ─────────────────────────
// A real account's store always starts empty (see header comment above) —
// exactly the "fresh state" the Products tab needs by default. `&demo=1`
// overlays a small seeded catalog (lib/previewSellerProducts.ts) purely
// in-memory, session-scoped, never written to AsyncStorage, so a stray
// `demo=1` can never leave fake products behind in a real account's data.
// Both devPreview (which imports react-native's Platform) and
// previewSellerProducts (which imports expo-asset) are lazily, dynamically
// imported — not statically imported — so pulling either into the module
// graph never happens for a caller that only ever touches the plain
// CRUD/draft functions below (what let this module stay mockable with just
// AsyncStorage/serviceConfig/money in existing narrowly-scoped tests), and
// so `vi.mock` can still substitute them in tests that do exercise demo mode.
let _previewProducts: Product[] | null = null;

let _devPreviewModule: Promise<typeof import('@/lib/devPreview')> | null = null;

async function demoActive(): Promise<boolean> {
  try {
    // One shared import: draft sync can ask from a background push and a
    // list at the same moment.
    _devPreviewModule ??= import('@/lib/devPreview');
    const { isPreviewDemoMode } = await _devPreviewModule;
    return isPreviewDemoMode();
  } catch {
    // Narrowly-scoped tests that mock only this module's own direct
    // dependencies (AsyncStorage/serviceConfig/money) never resolve this —
    // demo mode is inert there, exactly like it is outside a dev-web preview.
    return false;
  }
}

async function ensurePreviewProducts(): Promise<Product[]> {
  if (_previewProducts === null) {
    const seed = await import('@/lib/previewSellerProducts');
    _previewProducts = seed.getPreviewSellerProducts();
  }
  return _previewProducts;
}

async function findPreviewProduct(id: string): Promise<Product | undefined> {
  if (!(await demoActive())) return undefined;
  return (await ensurePreviewProducts()).find(p => p.id === id);
}

// ─── Storage Keys (scoped by user ID so two accounts never share storage) ─────

/** Legacy, unscoped keys from before per-account scoping. Migrated once into
 *  the first user to initialize the service on a given device, then removed
 *  so they can never leak into a different account afterward. */
const LEGACY_PRODUCTS_KEY     = '@brandthread/products';
const LEGACY_COLLECTIONS_KEY  = '@brandthread/collections';
const LEGACY_MIGRATION_V1_KEY = '@brandthread/migration_v1_demo_purged';

/** Set by initProductService() after sign-in. Falls back to 'anon' so the
 *  service is safe to call before the user ID is available. */
let _productUserId = 'anon';

/** Call once after Clerk resolves the current user ID (and again on sign-out
 *  with null, or when the signed-in user changes) so a different account
 *  never reads/writes the previous account's cached products. */
export function initProductService(userId: string | null): void {
  const newUserId = userId ?? 'anon';
  if (newUserId === _productUserId) return;
  _productUserId = newUserId;
  _initialized = false;
  _products = [];
  _collections = [];
}

function keys(uid = _productUserId) {
  return {
    products:    `@brandthread/products:${uid}`,
    collections: `@brandthread/collections:${uid}`,
    draftPrefix: `@brandthread/draft_${uid}_`,
    migrated:    `@brandthread/migration_v2_scoped:${uid}`,
  };
}

/** One-time migration marker for the legacy demo-record purge, kept per-user
 *  now that storage is user-scoped. */
function legacyDemoPurgedKey(uid: string): string {
  return `${LEGACY_MIGRATION_V1_KEY}:${uid}`;
}

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

/** Move data written before per-account scoping existed into the first
 *  account that initializes on this device, then delete the legacy key so
 *  it can never be picked up by a second account later. */
async function migrateLegacyStore(uid: string, k: ReturnType<typeof keys>): Promise<void> {
  const already = await AsyncStorage.getItem(k.migrated).catch(() => null);
  if (already) return;
  try {
    const [existingScoped, legacyProducts, legacyCollections] = await Promise.all([
      AsyncStorage.getItem(k.products),
      AsyncStorage.getItem(LEGACY_PRODUCTS_KEY),
      AsyncStorage.getItem(LEGACY_COLLECTIONS_KEY),
    ]);
    if (!existingScoped && legacyProducts) {
      await AsyncStorage.setItem(k.products, legacyProducts);
    }
    if (legacyCollections) {
      const existingScopedCollections = await AsyncStorage.getItem(k.collections);
      if (!existingScopedCollections) await AsyncStorage.setItem(k.collections, legacyCollections);
    }
    await AsyncStorage.multiRemove([LEGACY_PRODUCTS_KEY, LEGACY_COLLECTIONS_KEY]);
  } catch { /* non-fatal — worst case the legacy data is left in place */ }
  await AsyncStorage.setItem(k.migrated, '1').catch(() => {});
}

async function ensureInitialized() {
  if (_initialized) return;
  const uid = _productUserId;
  const k = keys(uid);

  await migrateLegacyStore(uid, k);

  // One-time migration: remove known legacy demo records on existing devices.
  // Uses exact known IDs so no legitimate user record is touched.
  const migrated = await AsyncStorage.getItem(legacyDemoPurgedKey(uid)).catch(() => null);
  if (!migrated) {
    try {
      const rawProducts = await AsyncStorage.getItem(k.products);
      if (rawProducts) {
        const stored: Product[] = JSON.parse(rawProducts);
        const cleaned = stored.filter(p => !LEGACY_DEMO_PRODUCT_IDS.has(p.id));
        if (cleaned.length !== stored.length) {
          await AsyncStorage.setItem(k.products, JSON.stringify(cleaned));
        }
      }
    } catch { /* non-fatal */ }
    try {
      const rawCols = await AsyncStorage.getItem(k.collections);
      if (rawCols) {
        const stored: ProductCollection[] = JSON.parse(rawCols);
        const cleaned = stored.filter(c => !LEGACY_DEMO_COLLECTION_IDS.has(c.id));
        if (cleaned.length !== stored.length) {
          await AsyncStorage.setItem(k.collections, JSON.stringify(cleaned));
        }
      }
    } catch { /* non-fatal */ }
    await AsyncStorage.setItem(legacyDemoPurgedKey(uid), '1').catch(() => {});
  }

  // An init() call (account switch) may have landed while these awaits were
  // in flight. Never hydrate a different account's data into the active one.
  if (_productUserId !== uid) return;

  try {
    const raw = await AsyncStorage.getItem(k.products);
    if (raw) _products = JSON.parse(raw);
  } catch { /* start empty */ }
  try {
    const rawCols = await AsyncStorage.getItem(k.collections);
    if (rawCols) _collections = JSON.parse(rawCols);
  } catch { /* start empty */ }
  if (_productUserId === uid) _initialized = true;
}

async function persist() {
  try { await AsyncStorage.setItem(keys().products, JSON.stringify(_products)); } catch { /* non-fatal */ }
}

function uid(): string {
  return 'prod_' + Math.random().toString(36).slice(2, 11);
}

// ─── Product CRUD ─────────────────────────────────────────────────────────────

export async function getProducts(query?: ProductSearchQuery): Promise<Product[]> {
  await ensureInitialized();
  let list = (await demoActive()) ? [..._products, ...(await ensurePreviewProducts())] : [..._products];

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
  return _products.find(p => p.id === id) ?? (await findPreviewProduct(id));
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
  if (idx !== -1) {
    _products[idx] = { ..._products[idx], ...patch, id, updatedAt: new Date().toISOString() };
    await persist();
    return _products[idx];
  }
  // Demo preview products live only in the in-memory overlay above — edits
  // (e.g. from the stock editor) apply there so the demo stays interactive
  // without ever touching a real account's AsyncStorage.
  if (await demoActive()) {
    const preview = await ensurePreviewProducts();
    const previewIdx = preview.findIndex(p => p.id === id);
    if (previewIdx !== -1) {
      preview[previewIdx] = { ...preview[previewIdx], ...patch, id, updatedAt: new Date().toISOString() };
      return preview[previewIdx];
    }
  }
  return undefined;
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

/**
 * Adjusts a single variant's stock (the per-variant "size/color" quick
 * editor) and keeps `Product.inventory`'s aggregate fields — `totalStock`,
 * `availableStock`, `variantStock` — in sync with the variant list, the
 * same fields `adjustInventory` above and the Products list/cards already
 * read. Reuses the existing `ProductVariant.inventoryQuantity` /
 * `ProductInventory.variantStock` fields (populated by Add Product) rather
 * than introducing a new stock model.
 */
export async function adjustVariantStock(
  productId: string,
  variantId: string,
  delta: number,
  reason: string
): Promise<InventoryAdjustment | undefined> {
  const product = await getProduct(productId);
  if (!product) return undefined;
  const variantIdx = product.variants.findIndex(v => v.id === variantId);
  if (variantIdx === -1) return undefined;

  const variant = product.variants[variantIdx];
  const newQty = Math.max(0, variant.inventoryQuantity + delta);
  const actualDelta = newQty - variant.inventoryQuantity;

  const variants = [...product.variants];
  variants[variantIdx] = { ...variant, inventoryQuantity: newQty, updatedAt: new Date().toISOString() };
  const totalStock = variants.reduce((sum, v) => sum + v.inventoryQuantity, 0);
  const variantStock = variants.map(v => ({ variantId: v.id, quantity: v.inventoryQuantity }));

  const adj: InventoryAdjustment = {
    id: 'adj_' + Math.random().toString(36).slice(2),
    productId,
    variantId,
    locationId: product.inventory.locationStock[0]?.locationId ?? '',
    delta: actualDelta,
    reason,
    createdBy: product.sellerId || 'seller',
    createdAt: new Date().toISOString(),
  };

  await updateProduct(productId, {
    variants,
    inventory: {
      ...product.inventory,
      totalStock,
      availableStock: Math.max(0, product.inventory.availableStock + actualDelta),
      variantStock,
    },
  });

  return adj;
}

/** Sets a variant's stock to an exact value (the stock editor's direct-entry
 *  field) by computing and applying the equivalent delta. */
export async function setVariantStock(
  productId: string,
  variantId: string,
  quantity: number,
  reason: string
): Promise<InventoryAdjustment | undefined> {
  const product = await getProduct(productId);
  const variant = product?.variants.find(v => v.id === variantId);
  if (!variant) return undefined;
  return adjustVariantStock(productId, variantId, Math.max(0, Math.round(quantity)) - variant.inventoryQuantity, reason);
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
//
// Drafts are written to AsyncStorage first (instant, offline-safe — the
// wizard never waits on the network), then synced in the background to
// /api/product-drafts so they follow the account to other devices. Merge
// rules live in lib/productDraftSync.ts. Sync is skipped entirely when
// signed out, in the demo overlay (&demo=1), and in the signed-out seller
// preview (no token there; serviceRequest/uploads also throw 403).

const DRAFTS_API = '/api/product-drafts';
/** listDrafts/loadDraft never wait longer than this on the server. */
const DRAFT_FETCH_BUDGET_MS = 4_000;

function draftSyncKeys(uid = _productUserId) {
  return {
    meta:    `@brandthread/draftsync_${uid}`,
    uploads: `@brandthread/draftuploads_${uid}`,
  };
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

// Sync-bookkeeping read-modify-writes are serialized so overlapping syncs of
// different drafts can't drop each other's updates.
let _draftSyncChain: Promise<unknown> = Promise.resolve();
function serialized(task: () => Promise<void>): Promise<void> {
  const run = _draftSyncChain.then(task);
  _draftSyncChain = run.catch(() => {});
  return run.catch(() => {});
}

function updateDraftMeta(uid: string, fn: (meta: DraftSyncMetaMap) => DraftSyncMetaMap): Promise<void> {
  return serialized(async () => {
    const key = draftSyncKeys(uid).meta;
    const next = fn(await readJson<DraftSyncMetaMap>(key, {}));
    try { await AsyncStorage.setItem(key, JSON.stringify(next)); } catch { /* non-fatal */ }
  });
}

async function draftSyncAvailable(): Promise<boolean> {
  try {
    if (_productUserId === 'anon') return false;
    if (await demoActive()) return false;
    return typeof hasServiceToken === 'function' && (await hasServiceToken());
  } catch { return false; }
}

function withinBudget<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('draft sync timeout')), DRAFT_FETCH_BUDGET_MS); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

function errorStatus(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : undefined;
}

function isDraftRow(r: unknown): r is ServerDraftRow {
  const row = r as ServerDraftRow | null;
  return !!row && typeof row.clientDraftId === 'string' && typeof row.updatedAt === 'string'
    && !!row.data && typeof row.data === 'object' && !Array.isArray(row.data);
}

/** The server copy carried by a 409 DRAFT_STALE response, if any. */
function serverDraftFromError(err: unknown): ServerDraftRow | null {
  try {
    const body = (err as { body?: unknown } | null)?.body;
    const parsed = typeof body === 'string' ? JSON.parse(body) : null;
    return isDraftRow(parsed?.draft) ? parsed.draft : null;
  } catch { return null; }
}

/** Uploads device-local images once (cached by local URI) through the same
 *  pipeline Add Product publishes with, and returns the local→remote map. A
 *  failed upload is left out: the server copy keeps the local URI and the
 *  next save retries it. */
async function uploadDraftImages(uid: string, draft: ProductDraft): Promise<Record<string, string>> {
  const local = collectLocalImageUris(draft);
  if (local.length === 0) return {};
  const key = draftSyncKeys(uid).uploads;
  const cache = await readJson<Record<string, string>>(key, {});
  const missing = local.filter(u => !cache[u]);
  if (missing.length > 0 && typeof serviceUploadProductImage === 'function') {
    const fresh: Record<string, string> = {};
    for (const uri of missing) {
      if (_productUserId !== uid) break;
      try { fresh[uri] = await serviceUploadProductImage({ uri }); } catch { /* retry on next save */ }
    }
    if (Object.keys(fresh).length > 0) {
      Object.assign(cache, fresh);
      await serialized(async () => {
        const latest = await readJson<Record<string, string>>(key, {});
        try { await AsyncStorage.setItem(key, JSON.stringify({ ...latest, ...fresh })); } catch { /* non-fatal */ }
      });
    }
  }
  const map: Record<string, string> = {};
  for (const u of local) if (cache[u]) map[u] = cache[u];
  return map;
}

/** Writes a winning server copy into the local cache, unless the local copy
 *  has meanwhile become newer. Returns the cached draft, or null if skipped. */
async function cacheServerDraft(uid: string, row: ServerDraftRow): Promise<ProductDraft | null> {
  const key = keys(uid).draftPrefix + row.clientDraftId;
  const current = await readJson<ProductDraft | null>(key, null);
  if (current && timeOf(current.lastSavedAt) >= timeOf(row.updatedAt)) return null;
  const draft = draftFromServer(row);
  try { await AsyncStorage.setItem(key, JSON.stringify(draft)); } catch { /* non-fatal */ }
  await updateDraftMeta(uid, m => ({ ...m, [row.clientDraftId]: { syncedAt: row.updatedAt } }));
  return draft;
}

const _draftSyncInFlight = new Map<string, Promise<void>>();
const _draftSyncAgain = new Set<string>();

/** Pushes one local draft to the server in the background. Coalesces: saves
 *  landing while a push for the same draft is in flight queue exactly one
 *  follow-up push (which reads the latest local copy). */
function syncDraftInBackground(id: string): Promise<void> {
  const uid = _productUserId;
  const flightKey = `${uid}:${id}`;
  const existing = _draftSyncInFlight.get(flightKey);
  if (existing) { _draftSyncAgain.add(flightKey); return existing; }
  const run = (async () => {
    try {
      do {
        _draftSyncAgain.delete(flightKey);
        await pushDraft(uid, id);
      } while (_draftSyncAgain.has(flightKey) && _productUserId === uid);
    } catch { /* stays unsynced; retried on the next save or list */ }
    finally { _draftSyncInFlight.delete(flightKey); }
  })();
  _draftSyncInFlight.set(flightKey, run);
  return run;
}

async function pushDraft(uid: string, id: string): Promise<void> {
  if (_productUserId !== uid || !(await draftSyncAvailable())) return;
  const local = await readJson<ProductDraft | null>(keys(uid).draftPrefix + id, null);
  if (!local) return;
  const remoteFor = await uploadDraftImages(uid, local);
  const updatedAt = local.lastSavedAt;
  try {
    const res = await serviceRequest<{ draft?: ServerDraftRow }>(
      `${DRAFTS_API}/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify({ updatedAt, data: withRemoteImageUris(local, remoteFor) }) },
      false,
    );
    const syncedAt = isDraftRow(res?.draft) ? res.draft.updatedAt : updatedAt;
    await updateDraftMeta(uid, m => ({ ...m, [id]: { syncedAt } }));
  } catch (err) {
    if (errorStatus(err) !== 409) throw err;
    // Another device saved newer work: the server copy wins locally.
    const server = serverDraftFromError(err);
    if (server && _productUserId === uid) await cacheServerDraft(uid, server);
  }
}

async function deleteServerDraft(uid: string, id: string): Promise<void> {
  if (_productUserId !== uid || !(await draftSyncAvailable())) return;
  await serviceRequest(`${DRAFTS_API}/${encodeURIComponent(id)}`, { method: 'DELETE' }, false);
  await updateDraftMeta(uid, m => {
    const next = { ...m };
    delete next[id];
    return next;
  });
}

async function listLocalDrafts(uid: string): Promise<ProductDraft[]> {
  try {
    const draftPrefix = keys(uid).draftPrefix;
    const allKeys = await AsyncStorage.getAllKeys();
    const draftKeys = allKeys.filter(k => k.startsWith(draftPrefix));
    if (draftKeys.length === 0) return [];
    const pairs = await AsyncStorage.multiGet(draftKeys);
    return pairs
      .map(([, v]) => (v ? (JSON.parse(v) as ProductDraft) : null))
      .filter((d): d is ProductDraft => d !== null)
      .sort((a, b) => b.lastSavedAt.localeCompare(a.lastSavedAt));
  } catch { return []; }
}

export async function saveDraft(draft: ProductDraft): Promise<void> {
  try {
    await AsyncStorage.setItem(keys().draftPrefix + draft.id, JSON.stringify({ ...draft, lastSavedAt: new Date().toISOString() }));
  } catch { return; /* non-fatal; nothing new to sync either */ }
  // Fire-and-forget: the wizard's autosave never waits on the network.
  void syncDraftInBackground(draft.id);
}

export async function loadDraft(id: string): Promise<ProductDraft | null> {
  const uid = _productUserId;
  try {
    const raw = await AsyncStorage.getItem(keys(uid).draftPrefix + id);
    if (raw) return JSON.parse(raw);
  } catch { /* fall through to the server copy */ }
  // Only new-product wizard ids (draft_…) can be server-only; a product id
  // (Edit product) must not pay a network round-trip before its form loads.
  if (!id.startsWith('draft_') || !(await draftSyncAvailable())) return null;
  try {
    const meta = await readJson<DraftSyncMetaMap>(draftSyncKeys(uid).meta, {});
    if (meta[id]?.deleted) return null;
    const res = await withinBudget(serviceRequest<{ draft?: ServerDraftRow }>(`${DRAFTS_API}/${encodeURIComponent(id)}`, {}, false));
    if (!isDraftRow(res?.draft) || _productUserId !== uid) return null;
    return (await cacheServerDraft(uid, res.draft)) ?? draftFromServer(res.draft);
  } catch { return null; }
}

export async function deleteDraft(id: string): Promise<void> {
  const uid = _productUserId;
  try { await AsyncStorage.removeItem(keys(uid).draftPrefix + id); } catch { /* non-fatal */ }
  if (!(await draftSyncAvailable())) return;
  // Tombstone first so an offline discard can't come back from the server on
  // the next list; cleared once the server delete is confirmed. The server
  // call itself is not awaited — publish/discard never wait on the network.
  await updateDraftMeta(uid, m => ({ ...m, [id]: { deleted: true } }));
  // Let an in-flight autosave push land first, so it can't re-create the
  // server row after the delete (its follow-up finds no local copy and stops).
  const inFlight = _draftSyncInFlight.get(`${uid}:${id}`);
  void (async () => {
    if (inFlight) await inFlight.catch(() => {});
    await deleteServerDraft(uid, id);
  })().catch(() => {});
}

export async function listDrafts(): Promise<ProductDraft[]> {
  const uid = _productUserId;
  const local = await listLocalDrafts(uid);
  if (!(await draftSyncAvailable())) return local;

  let rows: ServerDraftRow[];
  try {
    const res = await withinBudget(serviceRequest<{ drafts?: unknown[] }>(DRAFTS_API, {}, false));
    if (!Array.isArray(res?.drafts)) return local;
    rows = res.drafts.filter(isDraftRow);
  } catch { return local; }
  if (_productUserId !== uid) return [];

  try {
    const meta = await readJson<DraftSyncMetaMap>(draftSyncKeys(uid).meta, {});
    const merged = mergeDrafts(local, rows, meta);
    const prefix = keys(uid).draftPrefix;
    if (merged.cacheWrites.length > 0) {
      await AsyncStorage.multiSet(merged.cacheWrites.map(d => [prefix + d.id, JSON.stringify(d)] as [string, string]));
    }
    if (merged.localDeletes.length > 0) {
      await AsyncStorage.multiRemove(merged.localDeletes.map(id => prefix + id));
    }
    // Apply only what this merge decided, leaving entries other syncs wrote
    // since we read `meta` alone.
    await updateDraftMeta(uid, current => {
      const next = { ...current };
      for (const id of new Set([...Object.keys(meta), ...Object.keys(merged.meta)])) {
        const unchanged = JSON.stringify(current[id]) === JSON.stringify(meta[id]);
        if (!unchanged) continue;
        if (merged.meta[id]) next[id] = merged.meta[id];
        else delete next[id];
      }
      return next;
    });
    for (const id of merged.pushIds) void syncDraftInBackground(id);
    for (const id of merged.retryDeleteIds) void deleteServerDraft(uid, id).catch(() => {});
    return merged.drafts;
  } catch { return local; }
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
  const list = (await demoActive()) ? [..._products, ...(await ensurePreviewProducts())] : _products;
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
