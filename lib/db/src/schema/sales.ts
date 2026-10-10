import { pgTable, uuid, text, integer, boolean, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

// ─── Automatic sales ────────────────────────────────────────────────────────
// Seller-defined price reductions that apply automatically (no code) for a
// date range. Resolved by api-server/src/lib/pricing/sales.ts. Migration 120.

export const sales = pgTable('sales', {
  id:           uuid('id').primaryKey().defaultRandom(),
  sellerId:     text('seller_id').notNull(),
  name:         text('name').notNull(),
  /** 'percent' (value 1..90) | 'fixed' (value = cents off each unit) */
  discountType: text('discount_type').notNull().default('percent'),
  value:        integer('value').notNull(),
  /** 'store' | 'products' | 'collection' */
  scope:        text('scope').notNull().default('store'),
  /** Collection name, matched against product category / tags (scope = 'collection'). */
  collection:   text('collection'),
  startsAt:     timestamp('starts_at', { withTimezone: true }).defaultNow().notNull(),
  endsAt:       timestamp('ends_at', { withTimezone: true }),
  active:       boolean('active').notNull().default(true),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  sellerActiveIdx: index('sales_seller_active_idx').on(table.sellerId, table.active, table.startsAt),
}));

// product_id references products(id) ON DELETE CASCADE in the migration; the FK
// is not repeated here to avoid a circular import with schema/index.ts.
export const productSales = pgTable('product_sales', {
  saleId:    uuid('sale_id').notNull().references(() => sales.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull(),
}, (table) => ({
  pk:         primaryKey({ columns: [table.saleId, table.productId] }),
  productIdx: index('product_sales_product_idx').on(table.productId),
}));
