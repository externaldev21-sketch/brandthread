/**
 * Brandthread Product System — Comprehensive Type Definitions
 *
 * Single source of truth for all product-related data models.
 * Do not import types from services/types.ts for product entities — use this file.
 */

// ─── Enums / Union Types ──────────────────────────────────────────────────────

export type ProductStatus = 'active' | 'draft' | 'scheduled' | 'archived' | 'hidden';

export type SalesModel = 'pre-order' | 'pre-made' | 'both';

export type FulfillmentType = 'seller' | 'manufacturer' | 'mixed';

export type InventoryPolicy = 'deny' | 'continue'; // deny=stop when 0, continue=allow oversell

export type VariantStatus = 'active' | 'inactive';

export type MediaType = 'image' | 'video' | 'mockup';

export type OptionType = 'size' | 'color' | 'material' | 'style' | 'custom';

export const PRODUCT_CATEGORIES = [
  'T-shirt', 'Hoodie', 'Sweatshirt', 'Sweatpants', 'Shorts',
  'Jacket', 'Denim', 'Dress', 'Skirt', 'Hat', 'Bag', 'Shoes',
  'Accessories', 'Other',
] as const;
export type ProductCategory = typeof PRODUCT_CATEGORIES[number];

export const SIZE_PRESETS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'] as const;
export type SizePreset = typeof SIZE_PRESETS[number];

export const COLOR_PRESETS: { name: string; hex: string }[] = [
  { name: 'Black',    hex: '#000000' },
  { name: 'White',    hex: '#FFFFFF' },
  { name: 'Navy',     hex: '#1B2A4A' },
  { name: 'Grey',     hex: '#9CA3AF' },
  { name: 'Cream',    hex: '#F5F0E8' },
  { name: 'Olive',    hex: '#6B7C45' },
  { name: 'Burgundy', hex: '#6D1A36' },
  { name: 'Forest',   hex: '#1A472A' },
  { name: 'Camel',    hex: '#C19A6B' },
  { name: 'Cobalt',   hex: '#0047AB' },
];

// ─── Media ────────────────────────────────────────────────────────────────────

export interface ProductMedia {
  id: string;
  type: MediaType;
  uri: string;         // local file URI or remote URL
  thumbnailUri?: string;
  altText?: string;
  isCover: boolean;
  sortOrder: number;
  uploadProgress?: number;  // 0–100 during upload
  uploadFailed?: boolean;
  variantId?: string;  // linked to a specific variant
  createdAt: string;
}

// ─── Options & Variants ───────────────────────────────────────────────────────

export interface ProductOption {
  id: string;
  type: OptionType;
  name: string;        // "Size", "Color", or custom name
  values: OptionValue[];
  sortOrder: number;
}

export interface OptionValue {
  id: string;
  value: string;       // "M", "Black", "#000000" for color hex, etc.
  label?: string;      // display label if different from value
  colorHex?: string;   // for color options
}

export interface ProductVariant {
  id: string;
  productId: string;
  title: string;       // auto-generated, e.g. "M / Black"
  optionValues: { optionId: string; valueId: string }[];
  sku: string;
  barcode?: string;
  price?: number;         // override; falls back to product price
  compareAtPrice?: number;
  cost?: number;          // override
  weight?: number;        // in grams
  inventoryQuantity: number;
  reservedQuantity: number;
  incomingQuantity: number;
  status: VariantStatus;
  imageId?: string;       // linked ProductMedia id
  requiresShipping: boolean;
  taxable: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Inventory ────────────────────────────────────────────────────────────────

export interface InventoryLocation {
  id: string;
  name: string;         // "Main Warehouse", "Studio", etc.
  address?: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface ProductInventory {
  productId: string;
  trackQuantity: boolean;
  allowOverselling: boolean;
  policy: InventoryPolicy;
  lowStockThreshold: number;
  totalStock: number;
  availableStock: number;
  reservedStock: number;
  incomingStock: number;
  locationStock: { locationId: string; quantity: number }[];
  variantStock: { variantId: string; quantity: number }[];
}

export interface InventoryAdjustment {
  id: string;
  productId: string;
  variantId?: string;
  locationId: string;
  delta: number;          // positive = add, negative = remove
  reason: string;
  note?: string;
  createdBy: string;
  createdAt: string;
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

export interface ProductPricing {
  price: number;
  compareAtPrice?: number;
  cost?: number;
  estimatedShippingCost?: number;
  estimatedFees?: number;
  currency: string;     // "USD"
}

// ─── Pre-order Settings ───────────────────────────────────────────────────────

export interface ProductPreorderSettings {
  openDate?: string;         // ISO date
  closeDate?: string;
  minOrderQty?: number;
  maxOrderQty?: number;
  productionStartDate?: string;
  estimatedCompletionDate?: string;
  estimatedShippingDate?: string;
  depositPercent?: number;   // 0–100, e.g. 20 for 20% deposit
  disclaimer?: string;
  fundingGoalUnits?: number; // units needed to fund production
  unitsOrdered: number;      // live counter
  isFunded: boolean;
}

// ─── Fulfillment ─────────────────────────────────────────────────────────────

export interface ProductFulfillment {
  type: FulfillmentType;
  weightGrams?: number;
  packageLengthCm?: number;
  packageWidthCm?: number;
  packageHeightCm?: number;
  shippingProfileId?: string;
  processingTimeDays?: number;
  countryOfOrigin?: string;
  harmonizedCode?: string;
  customsDescription?: string;
}

// ─── Manufacturing ────────────────────────────────────────────────────────────

export type ManufacturingStage =
  | 'none' | 'quote_requested' | 'quote_received' | 'sample_pending'
  | 'sample_approved' | 'in_production' | 'quality_check' | 'shipped';

export interface ProductManufacturing {
  manufacturerId?: string;
  manufacturerName?: string;
  stage: ManufacturingStage;
  targetCostPerUnit?: number;
  requiredQuantity?: number;
  productionDeadline?: string;
  techPackUri?: string;
  designFileUris?: string[];
  measurementsUri?: string;
  quoteId?: string;
  estimatedCompletionDate?: string;
  sampleStatus?: 'none' | 'pending' | 'received' | 'approved' | 'rejected';
  unitsInProduction?: number;
  qualityCheckPassed?: boolean;
  shipmentTracking?: string;
}

// ─── Storefront / SEO ─────────────────────────────────────────────────────────

export interface ProductSEO {
  title?: string;
  description?: string;
  urlHandle?: string;
  searchVisible: boolean;
}

export interface ProductStoreSettings {
  status: ProductStatus;
  scheduledPublishDate?: string;
  collectionIds: string[];
  featuredOnHomepage: boolean;
  badge?: string;           // "New", "Sale", "Limited" etc.
  relatedProductIds: string[];
  seo: ProductSEO;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface ProductAnalytics {
  productId: string;
  revenue: number;
  unitsSold: number;
  pageViews: number;
  addToCartCount: number;
  conversionRate: number;   // 0–1
  addToCartRate: number;    // 0–1
  refundRate: number;       // 0–1
  returnRate: number;       // 0–1
  bestVariantId?: string;
  bestSize?: string;
  bestColor?: string;
  sellThroughRate: number;  // 0–1
  revenueByDay: { date: string; revenue: number }[];
}

// ─── Collections ─────────────────────────────────────────────────────────────

export interface ProductCollection {
  id: string;
  name: string;
  description?: string;
  imageUri?: string;
  productIds: string[];
  isActive: boolean;
  createdAt: string;
}

// ─── Top-level Product ────────────────────────────────────────────────────────

export interface Product {
  id: string;
  sellerId: string;
  name: string;
  description: string;
  category: ProductCategory;
  productType?: string;
  vendor?: string;
  tags: string[];

  // Media
  media: ProductMedia[];

  // Pricing
  pricing: ProductPricing;

  // Options & Variants
  options: ProductOption[];
  variants: ProductVariant[];

  // Inventory
  inventory: ProductInventory;

  // Sales Model
  salesModel: SalesModel;
  preorderSettings?: ProductPreorderSettings;

  // Fulfillment
  fulfillment: ProductFulfillment;

  // Manufacturing
  manufacturing: ProductManufacturing;

  // Storefront
  storeSettings: ProductStoreSettings;

  // Analytics (summary only — full analytics fetched separately)
  totalSales: number;
  totalRevenue: number;

  // Meta
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

// ─── Product Tag (for content system) ────────────────────────────────────────

export interface ProductTag {
  productId: string;
  variantId?: string;
  label?: string;        // optional display override
  position?: { x: number; y: number };
}

// ─── Draft (incomplete product being created) ─────────────────────────────────

export type ProductDraft = Partial<Product> & {
  id: string;
  isDraft: true;
  currentStep: number;
  lastSavedAt: string;
};

// ─── Filter / Search ──────────────────────────────────────────────────────────

export type ProductFilter =
  | 'all' | 'active' | 'draft' | 'scheduled' | 'archived'
  | 'pre-order' | 'pre-made' | 'low-stock' | 'out-of-stock';

export interface ProductSearchQuery {
  text?: string;
  filter?: ProductFilter;
  category?: ProductCategory;
  collectionId?: string;
  sortBy?: 'name' | 'createdAt' | 'updatedAt' | 'price' | 'inventory' | 'sales';
  sortDir?: 'asc' | 'desc';
}
