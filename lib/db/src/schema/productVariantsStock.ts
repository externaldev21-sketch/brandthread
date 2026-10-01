/**
 * Variant option axes + per-product stock rules. Side tables only — the
 * `products` / `product_variants` tables are untouched (size + colour stay on
 * the variant columns; fit and any custom axes live in `product_variant_options`).
 */
import { pgTable, uuid, text, integer, timestamp, boolean, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import { products, productVariants } from './index';

/** Ordered option axes of a product, e.g. Size [S,M,L], Colour [Black,White], Fit [Slim,Regular]. */
export const productOptionAxes = pgTable('product_option_axes', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  values: text('values').array().notNull().default([] as string[]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  productNameUnique: uniqueIndex('product_option_axes_product_name_uq').on(table.productId, table.name),
}));

/** Fit + custom axis values of one variant: { "Fit": "Slim", "Material": "Linen" }. */
export const productVariantOptions = pgTable('product_variant_options', {
  variantId: uuid('variant_id').primaryKey().references(() => productVariants.id, { onDelete: 'cascade' }),
  options: jsonb('options').$type<Record<string, string>>().notNull().default({}),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** Per-product stock behaviour: sold-out handling, low-stock default, limited edition + remaining counter. */
export const productStockRules = pgTable('product_stock_rules', {
  productId: uuid('product_id').primaryKey().references(() => products.id, { onDelete: 'cascade' }),
  lowStockThresholdDefault: integer('low_stock_threshold_default'),
  soldOutBehavior: text('sold_out_behavior').notNull().default('show'), // 'show' | 'hide' | 'archive'
  limitedQuantityEnabled: boolean('limited_quantity_enabled').notNull().default(false),
  limitedQuantityTotal: integer('limited_quantity_total'),
  showRemainingCounter: boolean('show_remaining_counter').notNull().default(false),
  counterThreshold: integer('counter_threshold'),
  // Set when WE hid / archived the product because it sold out, so a restock only
  // restores what this feature changed (never a seller's own draft/archive).
  autoHiddenAt: timestamp('auto_hidden_at'),
  autoArchivedAt: timestamp('auto_archived_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
