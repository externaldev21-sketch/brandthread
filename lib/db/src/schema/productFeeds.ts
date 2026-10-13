import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * One secret product-feed URL per seller (Meta Commerce Manager / TikTok
 * catalog scheduled feeds). The token is stored as-is: the seller must be able
 * to copy the same URL again to paste into Meta/TikTok, and the feed only
 * serves data that is already public (published products). Regenerating
 * replaces the row's token, so every earlier URL stops working at once.
 */
export const productFeeds = pgTable('product_feeds', {
  sellerId:        text('seller_id').primaryKey(),
  token:           text('token').notNull(),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  rotatedAt:       timestamp('rotated_at', { withTimezone: true }).defaultNow().notNull(),
  metaFetchedAt:   timestamp('meta_fetched_at', { withTimezone: true }),
  tiktokFetchedAt: timestamp('tiktok_fetched_at', { withTimezone: true }),
}, (t) => ({
  tokenUidx: uniqueIndex('product_feeds_token_unique').on(t.token),
}));

export type ProductFeed = typeof productFeeds.$inferSelect;
