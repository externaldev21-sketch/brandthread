import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// When a seller first shared their store link (migration 262). Drives the
// "Share your store" step of the dashboard's Get ready to sell checklist.
export const sellerStoreShares = pgTable('seller_store_shares', {
  sellerId:      text('seller_id').primaryKey(),
  firstSharedAt: timestamp('first_shared_at', { withTimezone: true }).defaultNow().notNull(),
  lastSharedAt:  timestamp('last_shared_at', { withTimezone: true }).defaultNow().notNull(),
  shareCount:    integer('share_count').notNull().default(1),
});
