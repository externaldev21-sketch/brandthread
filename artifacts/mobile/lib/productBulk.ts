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
