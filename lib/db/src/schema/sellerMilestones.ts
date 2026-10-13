/**
 * Seller milestones (migration 291): first sale, $1K / $10K / $100K in sales,
 * 100 and 1,000 orders. Written by api-server routes/seller-milestones.ts.
 */
import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const sellerMilestones = pgTable('seller_milestones', {
  ownerId:   text('owner_id').notNull(),
  key:       text('key').notNull(),
  reachedAt: timestamp('reached_at', { withTimezone: true }).defaultNow().notNull(),
  seenAt:    timestamp('seen_at', { withTimezone: true }),
  productId: uuid('product_id'),
}, (t) => ({
  pk: primaryKey({ columns: [t.ownerId, t.key] }),
}));
