/**
 * Brandthread Product Service
 *
 * Demo implementation of all product CRUD operations.
 * Real API calls are stubbed — replace with actual network calls when backend is ready.
 * All demo logic is isolated here; UI components must not contain demo fallbacks.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Product, ProductDraft, ProductFilter, ProductSearchQuery,
  ProductMedia, ProductVariant, ProductOption, ProductCategory,
  InventoryAdjustment, ProductAnalytics, ProductCollection,
  SalesModel, ProductStatus,
} from '@/services/productTypes';
import { calcTotalInventory } from '@/lib/productUtils';

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const PRODUCTS_KEY      = '@brandthread/products';
const COLLECTIONS_KEY   = '@brandthread/collections';
const DRAFT_PREFIX      = '@brandthread/draft_';
const INVENTORY_ADJ_KEY = '@brandthread/inventory_adj';

// ─── Demo Data ────────────────────────────────────────────────────────────────

const now = new Date().toISOString();
const yesterday = new Date(Date.now() - 86400000).toISOString();
const lastWeek  = new Date(Date.now() - 7 * 86400000).toISOString();

export const DEMO_FULL_PRODUCTS: Product[] = [
  {
    id: 'prod_001',
    sellerId: 'seller_001',
    name: 'Vintage Washed Tee',
    description: 'Premium heavyweight cotton tee with a vintage wash finish.\n\n**Fit:** Relaxed oversized\n**Material:** 100% 300gsm cotton\n**Care:** Cold wash, hang dry',
    category: 'T-shirt',
    productType: 'Apparel',
    vendor: 'Vault Studio',
    tags: ['streetwear', 'basics', 'oversized'],
    media: [
      { id: 'm001', type: 'image', uri: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400', isCover: true, sortOrder: 0, createdAt: lastWeek },
      { id: 'm002', type: 'image', uri: 'https://images.unsplash.com/photo-1503341504253-dff4815485f1?w=400', isCover: false, sortOrder: 1, createdAt: lastWeek },
    ],
    pricing: { price: 68, compareAtPrice: 85, cost: 22, estimatedShippingCost: 5, estimatedFees: 3.5, currency: 'USD' },
    options: [
      { id: 'opt_size', type: 'size', name: 'Size', values: [
        { id: 'v_xs', value: 'XS' }, { id: 'v_s', value: 'S' }, { id: 'v_m', value: 'M' }, { id: 'v_l', value: 'L' }, { id: 'v_xl', value: 'XL' },
      ], sortOrder: 0 },
      { id: 'opt_color', type: 'color', name: 'Color', values: [
        { id: 'c_black', value: 'Black', colorHex: '#1a1a1a' }, { id: 'c_white', value: 'White', colorHex: '#F5F0E8' }, { id: 'c_navy', value: 'Navy', colorHex: '#1B2A4A' },
      ], sortOrder: 1 },
    ],
    variants: [
      { id: 'var_001', productId: 'prod_001', title: 'S / Black', optionValues: [{ optionId: 'opt_size', valueId: 'v_s' }, { optionId: 'opt_color', valueId: 'c_black' }], sku: 'VWT-S-BLK', inventoryQuantity: 12, reservedQuantity: 2, incomingQuantity: 0, status: 'active', requiresShipping: true, taxable: true, createdAt: lastWeek, updatedAt: lastWeek },
      { id: 'var_002', productId: 'prod_001', title: 'M / Black', optionValues: [{ optionId: 'opt_size', valueId: 'v_m' }, { optionId: 'opt_color', valueId: 'c_black' }], sku: 'VWT-M-BLK', inventoryQuantity: 18, reservedQuantity: 3, incomingQuantity: 0, status: 'active', requiresShipping: true, taxable: true, createdAt: lastWeek, updatedAt: lastWeek },
      { id: 'var_003', productId: 'prod_001', title: 'M / White', optionValues: [{ optionId: 'opt_size', valueId: 'v_m' }, { optionId: 'opt_color', valueId: 'c_white' }], sku: 'VWT-M-WHT', inventoryQuantity: 3, reservedQuantity: 0, incomingQuantity: 12, status: 'active', requiresShipping: true, taxable: true, createdAt: lastWeek, updatedAt: lastWeek },
      { id: 'var_004', productId: 'prod_001', title: 'L / Navy', optionValues: [{ optionId: 'opt_size', valueId: 'v_l' }, { optionId: 'opt_color', valueId: 'c_navy' }], sku: 'VWT-L-NVY', inventoryQuantity: 0, reservedQuantity: 0, incomingQuantity: 24, status: 'active', requiresShipping: true, taxable: true, createdAt: lastWeek, updatedAt: lastWeek },
    ],
    inventory: { productId: 'prod_001', trackQuantity: true, allowOverselling: false, policy: 'deny', lowStockThreshold: 5, totalStock: 33, availableStock: 28, reservedStock: 5, incomingStock: 36, locationStock: [{ locationId: 'loc_main', quantity: 33 }], variantStock: [] },
    salesModel: 'pre-made',
    fulfillment: { type: 'seller', weightGrams: 280, packageLengthCm: 30, packageWidthCm: 25, packageHeightCm: 4, processingTimeDays: 2, countryOfOrigin: 'US' },
    manufacturing: { stage: 'none' },
    storeSettings: { status: 'active', collectionIds: ['col_001'], featuredOnHomepage: true, badge: 'Sale', relatedProductIds: ['prod_002'], seo: { title: 'Vintage Washed Tee — Vault Studio', description: 'Premium heavyweight cotton tee with vintage wash.', urlHandle: 'vintage-washed-tee', searchVisible: true } },
    totalSales: 142, totalRevenue: 9656, status: 'active', createdAt: lastWeek, updatedAt: now, publishedAt: lastWeek,
  },
  {
    id: 'prod_002',
    sellerId: 'seller_001',
    name: 'Oversized Hoodie',
    description: 'Drop-shoulder heavyweight fleece hoodie.\n\n**Fit:** Ultra-oversized drop shoulder\n**Material:** 80% cotton, 20% polyester, 450gsm fleece\n**Care:** Cold wash inside out',
    category: 'Hoodie',
    productType: 'Apparel',
    vendor: 'Vault Studio',
    tags: ['streetwear', 'hoodie', 'heavyweight'],
    media: [
      { id: 'm003', type: 'image', uri: 'https://images.unsplash.com/photo-1509942774463-acf339cf87d5?w=400', isCover: true, sortOrder: 0, createdAt: lastWeek },
    ],
    pricing: { price: 145, compareAtPrice: undefined, cost: 48, estimatedShippingCost: 8, estimatedFees: 7.5, currency: 'USD' },
    options: [
      { id: 'opt_size2', type: 'size', name: 'Size', values: [
        { id: 'v2_s', value: 'S' }, { id: 'v2_m', value: 'M' }, { id: 'v2_l', value: 'L' }, { id: 'v2_xl', value: 'XL' },
      ], sortOrder: 0 },
    ],
    variants: [
      { id: 'var_010', productId: 'prod_002', title: 'S', optionValues: [{ optionId: 'opt_size2', valueId: 'v2_s' }], sku: 'OH-S', inventoryQuantity: 8, reservedQuantity: 1, incomingQuantity: 0, status: 'active', requiresShipping: true, taxable: true, createdAt: lastWeek, updatedAt: lastWeek },
      { id: 'var_011', productId: 'prod_002', title: 'M', optionValues: [{ optionId: 'opt_size2', valueId: 'v2_m' }], sku: 'OH-M', inventoryQuantity: 2, reservedQuantity: 2, incomingQuantity: 0, status: 'active', requiresShipping: true, taxable: true, createdAt: lastWeek, updatedAt: lastWeek },
      { id: 'var_012', productId: 'prod_002', title: 'L', optionValues: [{ optionId: 'opt_size2', valueId: 'v2_l' }], sku: 'OH-L', inventoryQuantity: 14, reservedQuantity: 0, incomingQuantity: 0, status: 'active', requiresShipping: true, taxable: true, createdAt: lastWeek, updatedAt: lastWeek },
    ],
    inventory: { productId: 'prod_002', trackQuantity: true, allowOverselling: false, policy: 'deny', lowStockThreshold: 4, totalStock: 24, availableStock: 21, reservedStock: 3, incomingStock: 0, locationStock: [{ locationId: 'loc_main', quantity: 24 }], variantStock: [] },
    salesModel: 'pre-made',
    fulfillment: { type: 'seller', weightGrams: 680, packageLengthCm: 38, packageWidthCm: 32, packageHeightCm: 8, processingTimeDays: 2, countryOfOrigin: 'US' },
    manufacturing: { stage: 'none' },
    storeSettings: { status: 'active', collectionIds: ['col_001'], featuredOnHomepage: false, relatedProductIds: ['prod_001'], seo: { urlHandle: 'oversized-hoodie', searchVisible: true } },
    totalSales: 58, totalRevenue: 8410, status: 'active', createdAt: lastWeek, updatedAt: now, publishedAt: lastWeek,
  },
  {
    id: 'prod_003',
    sellerId: 'seller_001',
    name: 'Limited Drop Cargo Pants',
    description: 'Pre-order drop. Technical cargo pants with utility pockets.\n\n**Fit:** Relaxed technical\n**Material:** Ripstop nylon blend\n**Pre-order closes:** 30 days from open',
    category: 'Sweatpants',
    productType: 'Bottoms',
    vendor: 'Vault Studio',
    tags: ['pre-order', 'cargo', 'technical'],
    media: [
      { id: 'm005', type: 'image', uri: 'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=400', isCover: true, sortOrder: 0, createdAt: yesterday },
    ],
    pricing: { price: 195, compareAtPrice: undefined, cost: 65, estimatedShippingCost: 10, estimatedFees: 10, currency: 'USD' },
    options: [
      { id: 'opt_size3', type: 'size', name: 'Size', values: [
        { id: 'v3_s', value: 'S' }, { id: 'v3_m', value: 'M' }, { id: 'v3_l', value: 'L' }, { id: 'v3_xl', value: 'XL' },
      ], sortOrder: 0 },
    ],
    variants: [
      { id: 'var_020', productId: 'prod_003', title: 'M', optionValues: [{ optionId: 'opt_size3', valueId: 'v3_m' }], sku: 'LDC-M', inventoryQuantity: 0, reservedQuantity: 0, incomingQuantity: 0, status: 'active', requiresShipping: true, taxable: true, createdAt: yesterday, updatedAt: yesterday },
    ],
    inventory: { productId: 'prod_003', trackQuantity: false, allowOverselling: true, policy: 'continue', lowStockThreshold: 0, totalStock: 0, availableStock: 0, reservedStock: 0, incomingStock: 0, locationStock: [], variantStock: [] },
    salesModel: 'pre-order',
    preorderSettings: { openDate: yesterday, closeDate: new Date(Date.now() + 30 * 86400000).toISOString(), minOrderQty: 1, maxOrderQty: 3, estimatedShippingDate: new Date(Date.now() + 90 * 86400000).toISOString(), fundingGoalUnits: 50, unitsOrdered: 23, isFunded: false, disclaimer: 'This is a pre-order item. Production begins when funding goal is reached.' },
    fulfillment: { type: 'manufacturer', weightGrams: 480, processingTimeDays: 90, countryOfOrigin: 'PT' },
    manufacturing: { stage: 'quote_received', manufacturerName: 'Euro Stitch Ltd', requiredQuantity: 50, productionDeadline: new Date(Date.now() + 60 * 86400000).toISOString() },
    storeSettings: { status: 'active', collectionIds: [], featuredOnHomepage: true, badge: 'Pre-order', relatedProductIds: [], seo: { urlHandle: 'limited-drop-cargo-pants', searchVisible: true } },
    totalSales: 23, totalRevenue: 4485, status: 'active', createdAt: yesterday, updatedAt: now, publishedAt: yesterday,
  },
  {
    id: 'prod_004',
    sellerId: 'seller_001',
    name: 'Utility Jacket Draft',
    description: 'Work in progress — technical utility jacket.',
    category: 'Jacket',
    productType: 'Outerwear',
    vendor: 'Vault Studio',
    tags: ['draft', 'utility'],
    media: [],
    pricing: { price: 285, currency: 'USD' },
    options: [],
    variants: [],
    inventory: { productId: 'prod_004', trackQuantity: true, allowOverselling: false, policy: 'deny', lowStockThreshold: 5, totalStock: 0, availableStock: 0, reservedStock: 0, incomingStock: 0, locationStock: [], variantStock: [] },
    salesModel: 'pre-made',
    fulfillment: { type: 'seller' },
    manufacturing: { stage: 'none' },
    storeSettings: { status: 'draft', collectionIds: [], featuredOnHomepage: false, relatedProductIds: [], seo: { searchVisible: false } },
    totalSales: 0, totalRevenue: 0, status: 'draft', createdAt: now, updatedAt: now,
  },
];

export const DEMO_COLLECTIONS: ProductCollection[] = [
  { id: 'col_001', name: 'Core Collection', description: 'Essential everyday pieces', productIds: ['prod_001', 'prod_002'], isActive: true, createdAt: lastWeek },
  { id: 'col_002', name: 'Limited Drops', description: 'Pre-order exclusives', productIds: ['prod_003'], isActive: true, createdAt: yesterday },
];

// ─── In-memory store (demo) ───────────────────────────────────────────────────

let _products: Product[] = [...DEMO_FULL_PRODUCTS];
let _collections: ProductCollection[] = [...DEMO_COLLECTIONS];
let _initialized = false;

async function ensureInitialized() {
  if (_initialized) return;
  try {
    const raw = await AsyncStorage.getItem(PRODUCTS_KEY);
    if (raw) _products = JSON.parse(raw);
  } catch { /* use defaults */ }
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
      else if (query.sortBy === 'price')   { av = a.pricing.price; bv = b.pricing.price; }
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

export async function createProduct(data: Partial<Product>): Promise<Product> {
  await ensureInitialized();
  const product: Product = {
    id: uid(),
    sellerId: 'seller_001',
    name: data.name ?? 'Untitled Product',
    description: data.description ?? '',
    category: data.category ?? 'Other',
    tags: data.tags ?? [],
    media: data.media ?? [],
    pricing: data.pricing ?? { price: 0, currency: 'USD' },
    options: data.options ?? [],
    variants: data.variants ?? [],
    inventory: data.inventory ?? { productId: '', trackQuantity: true, allowOverselling: false, policy: 'deny', lowStockThreshold: 5, totalStock: 0, availableStock: 0, reservedStock: 0, incomingStock: 0, locationStock: [], variantStock: [] },
    salesModel: data.salesModel ?? 'pre-made',
    fulfillment: data.fulfillment ?? { type: 'seller' },
    manufacturing: data.manufacturing ?? { stage: 'none' },
    storeSettings: data.storeSettings ?? { status: 'draft', collectionIds: [], featuredOnHomepage: false, relatedProductIds: [], seo: { searchVisible: false } },
    totalSales: 0,
    totalRevenue: 0,
    status: data.status ?? 'draft',
    createdAt: now,
    updatedAt: now,
    ...data,
  };
  product.inventory.productId = product.id;
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

export async function deleteProduct(id: string): Promise<boolean> {
  await ensureInitialized();
  const len = _products.length;
  _products = _products.filter(p => p.id !== id);
  await persist();
  return _products.length < len;
}

export async function duplicateProduct(id: string): Promise<Product | undefined> {
  const src = await getProduct(id);
  if (!src) return undefined;
  const copy: Partial<Product> = {
    ...src,
    id: uid(),
    name: src.name + ' (Copy)',
    status: 'draft',
    totalSales: 0,
    totalRevenue: 0,
    publishedAt: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    storeSettings: { ...src.storeSettings, status: 'draft' },
  };
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
    locationId: 'loc_main',
    delta,
    reason,
    createdBy: 'seller_001',
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
  const totalRevenue = p?.totalRevenue ?? 0;
  const unitsSold = p?.totalSales ?? 0;

  return {
    productId,
    revenue: totalRevenue,
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
    revenueByDay: Array.from({ length: 14 }, (_, i) => ({
      date: new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10),
      revenue: Math.round(totalRevenue * (0.04 + Math.random() * 0.12)),
    })),
  };
}

// ─── Collections ─────────────────────────────────────────────────────────────

export async function getCollections(): Promise<ProductCollection[]> {
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
    totalInventoryValue: list.reduce((s, p) => s + (p.pricing.cost ?? 0) * p.inventory.totalStock, 0),
  };
}
