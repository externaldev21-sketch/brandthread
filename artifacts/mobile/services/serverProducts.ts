/**
 * Maps the seller's own catalog rows from the API (GET /api/products list rows
 * and GET /api/products/:id detail rows) onto the app's local `Product` shape,
 * and merges them with products that exist only on this device (local drafts).
 *
 * Products published through add-product live on the server (it calls
 * api.products.create), so the Products tab and product-detail must read them
 * from there — the device cache alone never sees them.
 *
 * Pure module: no react-native imports, safe to unit test.
 */
import type { Product, ProductStatus, ProductVariant, ProductCategory } from '@/services/productTypes';
import { PRODUCT_CATEGORIES } from '@/services/productTypes';

export interface ServerProductVariantRow {
  id: string;
  productId?: string;
  size?: string | null;
  color?: string | null;
  sku?: string | null;
  priceCents?: number | null;
  compareAtPriceCents?: number | null;
  stock?: number | null;
  lowStockThreshold?: number | null;
  weightGrams?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ServerProductRow {
  id: string;
  ownerId?: string | null;
  name?: string | null;
  description?: string | null;
  category?: string | null;
  status?: string | null;
  images?: string[] | null;
  tags?: string[] | null;
  styleTags?: string[] | null;
  isPreOrder?: boolean | null;
  preOrderClosingDate?: string | null;
  preOrderEstShipDate?: string | null;
  sizeChartImageUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  // list-row aggregates
  variantCount?: number | null;
  totalStock?: number | null;
  lowStockCount?: number | null;
  minPriceCents?: number | null;
  // detail rows
  variants?: ServerProductVariantRow[] | null;
}

const STATUSES: ReadonlySet<ProductStatus> = new Set(['active', 'draft', 'scheduled', 'archived', 'hidden']);

function toStatus(raw: string | null | undefined): ProductStatus {
  return raw && STATUSES.has(raw as ProductStatus) ? (raw as ProductStatus) : 'draft';
}

function toCategory(raw: string | null | undefined): ProductCategory {
  if (!raw) return 'Other';
  const match = PRODUCT_CATEGORIES.find((c) => c.toLowerCase() === raw.toLowerCase());
  return match ?? 'Other';
}

function iso(value: string | null | undefined, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function mapVariant(v: ServerProductVariantRow, productId: string, now: string): ProductVariant {
  const title = [v.size, v.color].filter((x): x is string => !!x && !!x.trim()).join(' / ') || 'Default';
  return {
    id: v.id,
    productId,
    title,
    optionValues: [],
    sku: v.sku ?? '',
    ...(typeof v.priceCents === 'number' ? { priceCents: v.priceCents } : {}),
    ...(typeof v.compareAtPriceCents === 'number' ? { compareAtPriceCents: v.compareAtPriceCents } : {}),
    ...(typeof v.weightGrams === 'number' && v.weightGrams > 0 ? { weight: v.weightGrams } : {}),
    inventoryQuantity: typeof v.stock === 'number' ? v.stock : 0,
    reservedQuantity: 0,
    incomingQuantity: 0,
    status: 'active',
    requiresShipping: true,
    taxable: true,
    createdAt: iso(v.createdAt, now),
    updatedAt: iso(v.updatedAt, now),
  };
}

/** Server row → local Product. Only server-supplied values; unknowns are zero/empty, never invented. */
export function mapServerProduct(row: ServerProductRow): Product {
  const now = new Date().toISOString();
  const id = row.id;
  const variants = Array.isArray(row.variants) ? row.variants.map((v) => mapVariant(v, id, now)) : [];
  const variantPrices = variants.map((v) => v.priceCents).filter((p): p is number => typeof p === 'number');
  const priceCents = variantPrices.length
    ? Math.min(...variantPrices)
    : typeof row.minPriceCents === 'number' ? row.minPriceCents : 0;
  const compareAt = Array.isArray(row.variants)
    ? row.variants.map((v) => v.compareAtPriceCents).find((c): c is number => typeof c === 'number')
    : undefined;
  const totalStock = variants.length
    ? variants.reduce((sum, v) => sum + v.inventoryQuantity, 0)
    : typeof row.totalStock === 'number' ? row.totalStock : 0;
  const lowStockThreshold = Array.isArray(row.variants) && row.variants[0]?.lowStockThreshold != null
    ? Number(row.variants[0].lowStockThreshold)
    : 5;
  const status = toStatus(row.status);
  const images = Array.isArray(row.images) ? row.images.filter((u) => typeof u === 'string' && u) : [];
  const isPreOrder = !!row.isPreOrder;

  return {
    id,
    sellerId: row.ownerId ?? '',
    name: row.name || 'Untitled Product',
    description: row.description ?? '',
    category: toCategory(row.category),
    tags: Array.isArray(row.tags) ? row.tags : [],
    ...(Array.isArray(row.styleTags) ? { styleTags: row.styleTags } : {}),
    media: images.map((uri, i) => ({ id: `${id}-img-${i}`, type: 'image' as const, uri, isCover: i === 0, sortOrder: i, createdAt: iso(row.createdAt, now) })),
    ...(row.sizeChartImageUrl ? { sizeChartImageUrl: row.sizeChartImageUrl } : {}),
    pricing: { priceCents, currency: 'USD', ...(compareAt ? { compareAtPriceCents: compareAt } : {}) },
    options: [],
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
      variantStock: variants.map((v) => ({ variantId: v.id, quantity: v.inventoryQuantity })) as any,
    },
    salesModel: isPreOrder ? 'pre-order' : 'pre-made',
    ...(isPreOrder
      ? {
        preorderSettings: {
          ...(row.preOrderClosingDate ? { closeDate: row.preOrderClosingDate } : {}),
          ...(row.preOrderEstShipDate ? { estimatedShippingDate: row.preOrderEstShipDate } : {}),
        } as any,
      }
      : {}),
    fulfillment: { type: 'seller' } as any,
    manufacturing: { stage: 'none' } as any,
    storeSettings: {
      status,
      collectionIds: [],
      featuredOnHomepage: false,
      relatedProductIds: [],
      seo: { searchVisible: status === 'active' },
    } as any,
    totalSales: 0,
    totalRevenueCents: 0,
    status,
    createdAt: iso(row.createdAt, now),
    updatedAt: iso(row.updatedAt, row.createdAt ?? now),
  };
}

/**
 * Server products are authoritative for anything the server knows about;
 * device-only products (local drafts that were never published) are kept.
 * Newest first.
 */
export function mergeServerAndLocalProducts(server: Product[], local: Product[]): Product[] {
  const serverIds = new Set(server.map((p) => p.id));
  const merged = [...server, ...local.filter((p) => !serverIds.has(p.id))];
  return merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** Server product ids are UUIDs; device-only ids are `prod_xxxxxxxxx`. */
export function isServerProductId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
