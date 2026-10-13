/**
 * Store-wide inventory settings (migration 273). One row per seller, created
 * on first save; a missing row means the platform defaults.
 *
 * lowStockThresholdDefault is the store's low-stock level. It applies to every
 * variant that has no level of its own and whose product has no default:
 * variant → product default (product_stock_rules) → this → 5.
 */
import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const sellerInventorySettings = pgTable('seller_inventory_settings', {
  sellerId: text('seller_id').primaryKey(),
  lowStockThresholdDefault: integer('low_stock_threshold_default').notNull().default(5),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
