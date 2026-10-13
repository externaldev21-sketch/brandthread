import { pgTable, uuid, text, integer, boolean, timestamp, index, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── Wholesale price list ───────────────────────────────────────────────────
// One price list per seller for approved business buyers (Shopify B2B
// "catalog" model: an overall % adjustment plus fixed per-product prices and
// quantity rules). Resolved by api-server/src/lib/pricing/wholesale.ts.
// Migration 279.

/** A seller's wholesale settings. One row per seller (created on first save). */
export const wholesaleSettings = pgTable('wholesale_settings', {
  sellerId:          text('seller_id').primaryKey(),
  enabled:           boolean('enabled').notNull().default(false),
  /** Wholesale subtotal the order must reach, else the whole order is retail. */
  minOrderCents:     integer('min_order_cents').notNull().default(0),
  /** % off the retail price for products without a fixed wholesale price (0..90). */
  defaultPercentOff: integer('default_percent_off').notNull().default(0),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// product_id / variant_id reference products(id) / product_variants(id)
// ON DELETE CASCADE in the migration; the FKs are not repeated here to avoid a
// circular import with schema/index.ts (same as schema/sales.ts).
/**
 * Fixed wholesale price and/or minimum quantity for one product (variant_id
 * null, every variant) or one variant. A variant row wins over its product row.
 */
export const wholesalePrices = pgTable('wholesale_prices', {
  id:          uuid('id').primaryKey().defaultRandom(),
  sellerId:    text('seller_id').notNull(),
  productId:   uuid('product_id').notNull(),
  variantId:   uuid('variant_id'),
  /** Fixed unit price; null = use the default % off. */
  priceCents:  integer('price_cents'),
  /** Units of this line needed before the wholesale price applies. */
  minQuantity: integer('min_quantity').notNull().default(1),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  sellerIdx:      index('wholesale_prices_seller_idx').on(t.sellerId),
  productUnique:  uniqueIndex('wholesale_prices_product_uniq').on(t.productId).where(sql`variant_id IS NULL`),
  variantUnique:  uniqueIndex('wholesale_prices_variant_uniq').on(t.variantId).where(sql`variant_id IS NOT NULL`),
}));

/** A buyer's wholesale application to one seller. status: pending | approved | declined. */
export const wholesaleBuyers = pgTable('wholesale_buyers', {
  id:           uuid('id').primaryKey().defaultRandom(),
  sellerId:     text('seller_id').notNull(),
  buyerId:      text('buyer_id').notNull(),
  status:       text('status').notNull().default('pending'),
  businessName: text('business_name').notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  decidedAt:    timestamp('decided_at', { withTimezone: true }),
}, (t) => ({
  sellerBuyerUnique: unique('wholesale_buyers_seller_buyer_uniq').on(t.sellerId, t.buyerId),
  sellerStatusIdx:   index('wholesale_buyers_seller_status_idx').on(t.sellerId, t.status),
  buyerIdx:          index('wholesale_buyers_buyer_idx').on(t.buyerId),
}));
