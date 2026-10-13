import { pgTable, uuid, text, integer, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { products, productVariants, orderItems } from './index';

// ─── Mystery boxes (migration 264) ──────────────────────────────────────────
// A mystery box is an ordinary product (its own variant's stock = boxes left)
// plus a pool of candidate variants from the same seller. When the order is
// paid, each box unit is resolved to one candidate (api-server lib/mysteryBox).

export const mysteryBoxPools = pgTable('mystery_box_pools', {
  productId: uuid('product_id').primaryKey().references(() => products.id, { onDelete: 'cascade' }),
  /** 'at_purchase' (buyer sees the item on the order) | 'on_delivery' (kept hidden) */
  reveal: text('reveal').notNull().default('at_purchase'),
  /** Seller opt-in: show each item's chance on the product page. */
  showOdds: boolean('show_odds').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const mysteryBoxPoolItems = pgTable('mystery_box_pool_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => mysteryBoxPools.productId, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').notNull().references(() => productVariants.id, { onDelete: 'cascade' }),
  weight: integer('weight').notNull().default(1),
}, (t) => ({
  productVariantUidx: uniqueIndex('mystery_box_pool_items_product_variant_uidx').on(t.productId, t.variantId),
  variantIdx: index('mystery_box_pool_items_variant_idx').on(t.variantId),
}));

/** One row per box unit bought. variantId null = nothing was in stock; the seller fulfils by hand. */
export const mysteryBoxPicks = pgTable('mystery_box_picks', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderItemId: uuid('order_item_id').notNull().references(() => orderItems.id, { onDelete: 'cascade' }),
  unitIndex: integer('unit_index').notNull().default(0),
  variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
  pickedAt: timestamp('picked_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  orderItemUnitUidx: uniqueIndex('mystery_box_picks_order_item_unit_uidx').on(t.orderItemId, t.unitIndex),
}));
