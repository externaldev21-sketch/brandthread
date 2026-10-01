import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';

// Server-side seller funnel events (currently 'add_to_cart'), recorded from the
// buyer cart sync path. Product views stay in store_visits. viewerKey is a
// per-seller salted hash, never a raw user id. Pruned at 400 days.
export const sellerProductEvents = pgTable('seller_product_events', {
  id:        uuid('id').primaryKey().defaultRandom(),
  sellerId:  text('seller_id').notNull(),
  productId: uuid('product_id').notNull(),
  eventType: text('event_type').notNull(),
  viewerKey: text('viewer_key').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  sellerCreatedIdx: index('seller_product_events_seller_created_idx').on(table.sellerId, table.createdAt),
  sellerProductIdx: index('seller_product_events_seller_product_idx').on(table.sellerId, table.productId, table.createdAt),
  createdIdx:       index('seller_product_events_created_idx').on(table.createdAt),
}));

// One monthly target per seller. metric 'revenue' is integer cents.
export const sellerGoals = pgTable('seller_goals', {
  sellerId:    text('seller_id').primaryKey(),
  metric:      text('metric').notNull(),
  targetValue: integer('target_value').notNull(),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
});
