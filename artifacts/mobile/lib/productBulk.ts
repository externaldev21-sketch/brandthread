/**
 * Types and helpers for the bulk product editor and the per-product search
 * listing screens. The server owns all pricing maths; this file only turns
 * what the seller typed into a request and reads errors back.
 */
import { parseDecimalToCents } from '@/lib/money';

export type BulkStatusFilter = 'all' | 'active' | 'draft' | 'archived';

export interface BulkProduct {
  id: string;
  name: string;
  status: string;
  image: string | null;
  variantCount: number;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  totalStock: number;
  moderationLocked: boolean;
}

export interface BulkProductList { total: number; items: BulkProduct[] }

export type BulkPriceChange =
  | { mode: 'set'; value: number }
  | { mode: 'amount' | 'percent'; direction: 'increase' | 'decrease'; value: number };

export type BulkRounding = 'none' | 'end_99' | 'end_00';
export type BulkCompareAt = 'none' | 'previous' | 'clear';

export interface BulkPriceRequest {
  productIds: string[];
  change: BulkPriceChange;
  rounding?: BulkRounding;
  compareAt?: BulkCompareAt;
  preview?: boolean;
}

export interface BulkPriceVariant { variantId: string; sku: string; before: number; after: number }

export interface BulkPriceItem {
  productId: string;
  name: string;
  status: string;
  image: string | null;
  skipped: string | null;
  changed: boolean;
  beforeMin: number | null;
  beforeMax: number | null;
  afterMin: number | null;
  afterMax: number | null;
  variants: BulkPriceVariant[];
}

export interface BulkPriceResult {
  preview: boolean;
  summary: { products: number; changedProducts: number; skippedProducts: number; variants: number };
  items: BulkPriceItem[];
}

export interface ProductSeoInput {
  seoTitle?: string | null;
  seoDescription?: string | null;
  urlHandle?: string | null;
  noIndex?: boolean;
  socialImageUrl?: string | null;
}

export interface ProductSeoDetail {
  productId: string;
  productName: string;
  seo: {
    seoTitle: string | null;
    seoDescription: string | null;
    urlHandle: string | null;
    noIndex: boolean;
    socialImageUrl: string | null;
  };
  resolved: { title: string; description: string; handle: string; noIndex: boolean; image: string | null };
  suggestedHandle: string;
  storeName: string;
  limits: { title: number; description: number; handle: number };
}

export type BulkStockChange = { mode: 'set' | 'add' | 'remove'; value: number };

export interface BulkStockRequest {
  productIds: string[];
  change: BulkStockChange;
  preview?: boolean;
}

export interface BulkStockVariant {
  variantId: string;
  sku: string;
  before: number;
  after: number;
  lowStockThreshold: number;
}

export interface BulkStockItem {
  productId: string;
  name: string;
  status: string;
  image: string | null;
  skipped: string | null;
  changed: boolean;
  beforeTotal: number | null;
  afterTotal: number | null;
  /** Variants at or under their low-stock threshold after the change. */
  lowAfter: number;
  outAfter: number;
  variants: BulkStockVariant[];
}

export interface BulkStockResult {
  preview: boolean;
  summary: {
    products: number; changedProducts: number; skippedProducts: number; variants: number;
    lowAfter: number; outAfter: number;
  };
  items: BulkStockItem[];
}

export const STOCK_EDIT_MODES: Array<{ key: BulkStockChange['mode']; label: string }> = [
  { key: 'set', label: 'Set to' },
  { key: 'add', label: 'Add' },
  { key: 'remove', label: 'Remove' },
];

/** Turn the typed quantity into a server request. Null when the input is unusable. */
export function buildStockChange(mode: BulkStockChange['mode'], input: string): BulkStockChange | null {
  const text = input.trim();
  if (!/^\d{1,7}$/.test(text)) return null;
  const value = Number(text);
  if (value > 1_000_000) return null;
  if (mode !== 'set' && value === 0) return null;
  return { mode, value };
}

export type PriceEditMode = 'set' | 'percent_down' | 'percent_up' | 'amount_down' | 'amount_up';

export const PRICE_EDIT_MODES: Array<{ key: PriceEditMode; label: string; unit: '$' | '%' }> = [
  { key: 'percent_down', label: '% off', unit: '%' },
  { key: 'percent_up', label: '% more', unit: '%' },
  { key: 'amount_down', label: '$ off', unit: '$' },
  { key: 'amount_up', label: '$ more', unit: '$' },
  { key: 'set', label: 'Set price', unit: '$' },
];

/** Turn the typed number into a server request. Null when the input is unusable. */
export function buildPriceChange(mode: PriceEditMode, input: string): BulkPriceChange | null {
  const text = input.trim();
  if (!text) return null;
  if (mode === 'percent_down' || mode === 'percent_up') {
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(text)) return null;
    const bps = Math.round(Number(text) * 100);
    if (bps <= 0 || bps > 100_000) return null;
    if (mode === 'percent_down' && bps > 10_000) return null;
    return { mode: 'percent', direction: mode === 'percent_down' ? 'decrease' : 'increase', value: bps };
  }
  const cents = parseDecimalToCents(text);
  if (cents === null || cents <= 0) return null;
  if (mode === 'set') return { mode: 'set', value: cents };
  return { mode: 'amount', direction: mode === 'amount_down' ? 'decrease' : 'increase', value: cents };
}

/** Human message for a failed bulk / SEO request. */
export function bulkErrorMessage(err: unknown, fallback: string): string {
  const raw = (err as { body?: unknown })?.body;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown; code?: string };
      if (parsed.code === 'PLAN_LIMIT_REACHED' && typeof parsed.message === 'string') return parsed.message;
      if (parsed.code === 'PRODUCT_MODERATION_LOCKED') return 'Some selected listings are locked by a platform moderation action.';
      if (parsed.code === 'TOO_MANY_PRODUCTS') return 'Select up to 200 products at a time.';
      if (parsed.code === 'HANDLE_TAKEN') return 'That URL handle is already used by another product.';
      if (typeof parsed.error === 'string') return parsed.error;
      const nested = (parsed.error as { message?: string } | undefined)?.message;
      if (nested) return nested;
    } catch { /* not JSON */ }
  }
  return fallback;
}

export function errorCode(err: unknown): string | null {
  const raw = (err as { body?: unknown })?.body;
  if (typeof raw !== 'string') return null;
  try { return (JSON.parse(raw) as { code?: string }).code ?? null; } catch { return null; }
}

export function priceRangeLabel(min: number | null, max: number | null, format: (cents: number) => string): string {
  if (min === null || max === null) return 'No price';
  return min === max ? format(min) : `${format(min)} – ${format(max)}`;
}

// ─── Local planning (seller web preview) ─────────────────────────────────────
// The signed-out seller preview cannot reach the API, so `&demo=1` runs the
// bulk editor against a local copy of the preview catalog. These mirror the
// server's pure rules (api-server/src/lib/bulkStock.ts and bulkPricing.ts) so
// the preview shows exactly what a real account would see.

export const MAX_STOCK = 1_000_000;
const MIN_PRICE_CENTS = 1;
const MAX_PRICE_CENTS = 100_000_000;

export type StockLevel = 'out_of_stock' | 'low_stock' | 'in_stock';

export function computeNewStock(current: number, change: BulkStockChange): number {
  const base = Math.max(0, Math.trunc(current));
  const next = change.mode === 'set' ? change.value : change.mode === 'add' ? base + change.value : base - change.value;
  return Math.min(MAX_STOCK, Math.max(0, next));
}

export function stockLevel(stock: number, threshold: number): StockLevel {
  if (stock <= 0) return 'out_of_stock';
  if (stock <= threshold) return 'low_stock';
  return 'in_stock';
}

function clampPrice(cents: number): number {
  return Math.min(MAX_PRICE_CENTS, Math.max(MIN_PRICE_CENTS, cents));
}

function roundPrice(cents: number, rounding: BulkRounding): number {
  if (rounding === 'none') return clampPrice(cents);
  const dollars = Math.max(1, Math.round(cents / 100));
  return clampPrice(rounding === 'end_99' ? dollars * 100 - 1 : dollars * 100);
}

export function computeNewPrice(current: number, change: BulkPriceChange, rounding: BulkRounding = 'none'): number {
  let next: number;
  if (change.mode === 'set') next = change.value;
  else if (change.mode === 'amount') next = change.direction === 'increase' ? current + change.value : current - change.value;
  else {
    const bps = change.direction === 'increase' ? 10_000 + change.value : 10_000 - change.value;
    next = Math.round((current * Math.max(0, bps)) / 10_000);
  }
  next = clampPrice(next);
  const rounded = roundPrice(next, rounding);
  if (change.mode === 'set') return rounded;
  if (change.direction === 'decrease' && rounded > current) return clampPrice(Math.min(next, current));
  if (change.direction === 'increase' && rounded < current) return clampPrice(Math.max(next, current));
  return rounded;
}

export interface LocalBulkVariant {
  variantId: string;
  sku: string;
  stock: number;
  lowStockThreshold: number;
  priceCents: number;
  compareAtCents: number | null;
}

export interface LocalBulkEntry { product: BulkProduct; variants: LocalBulkVariant[] }

/** Minimal shape of a seller Product this module needs (services/productTypes). */
export interface LocalSourceProduct {
  id: string;
  name: string;
  status: string;
  media: Array<{ uri: string; isCover?: boolean }>;
  pricing: { priceCents: number; compareAtPriceCents?: number };
  variants: Array<{ id: string; sku: string; inventoryQuantity: number; priceCents?: number; compareAtPriceCents?: number }>;
  inventory: { totalStock: number; lowStockThreshold: number };
}

function withTotals(product: BulkProduct, variants: LocalBulkVariant[]): LocalBulkEntry {
  const prices = variants.map(v => v.priceCents);
  return {
    product: {
      ...product,
      minPriceCents: prices.length ? Math.min(...prices) : null,
      maxPriceCents: prices.length ? Math.max(...prices) : null,
      totalStock: variants.reduce((n, v) => n + v.stock, 0),
    },
    variants,
  };
}

/** Seller products → the bulk editor's catalog. A product without options keeps one default variant, as on the server. */
export function bulkCatalogFromProducts(products: LocalSourceProduct[]): LocalBulkEntry[] {
  return products.map(p => {
    const threshold = p.inventory.lowStockThreshold;
    const compareAt = p.pricing.compareAtPriceCents ?? null;
    const variants: LocalBulkVariant[] = p.variants.length > 0
      ? p.variants.map(v => ({
        variantId: v.id, sku: v.sku, stock: v.inventoryQuantity, lowStockThreshold: threshold,
        priceCents: v.priceCents ?? p.pricing.priceCents, compareAtCents: v.compareAtPriceCents ?? compareAt,
      }))
      : [{
        variantId: `${p.id}-default`, sku: p.id.toUpperCase(), stock: p.inventory.totalStock, lowStockThreshold: threshold,
        priceCents: p.pricing.priceCents, compareAtCents: compareAt,
      }];
    const cover = p.media.find(m => m.isCover)?.uri ?? p.media[0]?.uri ?? null;
    return withTotals({
      id: p.id, name: p.name, status: p.status, image: cover, variantCount: p.variants.length,
      minPriceCents: null, maxPriceCents: null, totalStock: 0, moderationLocked: false,
    }, variants);
  });
}

/** Same filter the server listing applies (name search + status). */
export function filterLocalCatalog(catalog: LocalBulkEntry[], q: string, status: BulkStatusFilter): BulkProduct[] {
  const needle = q.trim().toLowerCase();
  return catalog
    .map(e => e.product)
    .filter(p => (status === 'all' || p.status === status) && (!needle || p.name.toLowerCase().includes(needle)));
}

function selected(catalog: LocalBulkEntry[], ids: string[]): LocalBulkEntry[] {
  const want = new Set(ids);
  return catalog.filter(e => want.has(e.product.id));
}

export function planLocalStock(catalog: LocalBulkEntry[], ids: string[], change: BulkStockChange, preview = true): BulkStockResult {
  const items: BulkStockItem[] = selected(catalog, ids).map(({ product, variants }) => {
    const planned = variants.map(v => ({
      variantId: v.variantId, sku: v.sku, before: v.stock, after: computeNewStock(v.stock, change), lowStockThreshold: v.lowStockThreshold,
    }));
    const empty = planned.length === 0;
    return {
      productId: product.id, name: product.name, status: product.status, image: product.image,
      skipped: empty ? 'no_variants' : null,
      changed: planned.some(v => v.before !== v.after),
      beforeTotal: empty ? null : planned.reduce((n, v) => n + v.before, 0),
      afterTotal: empty ? null : planned.reduce((n, v) => n + v.after, 0),
      lowAfter: planned.filter(v => stockLevel(v.after, v.lowStockThreshold) === 'low_stock').length,
      outAfter: planned.filter(v => v.after === 0).length,
      variants: planned,
    };
  });
  return {
    preview,
    summary: {
      products: items.length,
      changedProducts: items.filter(i => i.changed).length,
      skippedProducts: items.filter(i => i.skipped).length,
      variants: items.reduce((n, i) => n + i.variants.filter(v => v.before !== v.after).length, 0),
      lowAfter: items.reduce((n, i) => n + i.lowAfter, 0),
      outAfter: items.reduce((n, i) => n + i.outAfter, 0),
    },
    items,
  };
}

export function planLocalPrice(
  catalog: LocalBulkEntry[], ids: string[], change: BulkPriceChange, rounding: BulkRounding, compareAt: BulkCompareAt, preview = true,
): BulkPriceResult & { compareAfter: Record<string, number | null> } {
  const compareAfter: Record<string, number | null> = {};
  const items: BulkPriceItem[] = selected(catalog, ids).map(({ product, variants }) => {
    const planned = variants.map(v => {
      const after = computeNewPrice(v.priceCents, change, rounding);
      const cmp = compareAt === 'none' ? v.compareAtCents : compareAt === 'clear' ? null : after < v.priceCents ? v.priceCents : null;
      compareAfter[v.variantId] = cmp;
      return { variantId: v.variantId, sku: v.sku, before: v.priceCents, after, cmpChanged: cmp !== v.compareAtCents };
    });
    const befores = planned.map(v => v.before);
    const afters = planned.map(v => v.after);
    const empty = planned.length === 0;
    return {
      productId: product.id, name: product.name, status: product.status, image: product.image,
      skipped: empty ? 'no_variants' : null,
      changed: planned.some(v => v.before !== v.after || v.cmpChanged),
      beforeMin: empty ? null : Math.min(...befores), beforeMax: empty ? null : Math.max(...befores),
      afterMin: empty ? null : Math.min(...afters), afterMax: empty ? null : Math.max(...afters),
      variants: planned.map(({ cmpChanged: _c, ...v }) => v),
    };
  });
  return {
    preview,
    summary: {
      products: items.length,
      changedProducts: items.filter(i => i.changed).length,
      skippedProducts: items.filter(i => i.skipped).length,
      variants: items.reduce((n, i) => n + i.variants.filter(v => v.before !== v.after).length, 0),
    },
    items,
    compareAfter,
  };
}

/** Write a planned stock change back into the local catalog. */
export function applyLocalStock(catalog: LocalBulkEntry[], result: BulkStockResult): LocalBulkEntry[] {
  const next = new Map<string, number>();
  for (const it of result.items) for (const v of it.variants) next.set(v.variantId, v.after);
  return catalog.map(e => withTotals(e.product, e.variants.map(v => (next.has(v.variantId) ? { ...v, stock: next.get(v.variantId)! } : v))));
}

/** Write a planned price change back into the local catalog. */
export function applyLocalPrice(
  catalog: LocalBulkEntry[], result: BulkPriceResult & { compareAfter: Record<string, number | null> },
): LocalBulkEntry[] {
  const next = new Map<string, number>();
  for (const it of result.items) for (const v of it.variants) next.set(v.variantId, v.after);
  return catalog.map(e => withTotals(e.product, e.variants.map(v => (next.has(v.variantId)
    ? { ...v, priceCents: next.get(v.variantId)!, compareAtCents: result.compareAfter[v.variantId] ?? null }
    : v))));
}

/** Product-level stock marker for list rows: "Out of stock", "Low stock, N left" or "N in stock". */
export function stockStatusLabel(total: number, threshold: number | null): { level: StockLevel; label: string } {
  if (total <= 0) return { level: 'out_of_stock', label: 'Out of stock' };
  if (threshold !== null && total <= threshold) return { level: 'low_stock', label: `Low stock, ${total} left` };
  return { level: 'in_stock', label: `${total} in stock` };
}

/** Flags for one stock-preview row: which variants end low or out of stock. */
export function stockPreviewFlags(item: Pick<BulkStockItem, 'lowAfter' | 'outAfter' | 'variants'>): Array<{ level: Exclude<StockLevel, 'in_stock'>; label: string }> {
  const flags: Array<{ level: Exclude<StockLevel, 'in_stock'>; label: string }> = [];
  const single = item.variants.length <= 1;
  if (item.outAfter > 0) {
    flags.push({ level: 'out_of_stock', label: single || item.outAfter === item.variants.length ? 'Out of stock' : `${item.outAfter} out of stock` });
  }
  if (item.lowAfter > 0) {
    flags.push({ level: 'low_stock', label: single ? 'Low stock' : `${item.lowAfter} low stock` });
  }
  return flags;
}
