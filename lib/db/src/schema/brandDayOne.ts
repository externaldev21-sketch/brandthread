import { pgTable, text, integer, uuid, timestamp, primaryKey, index, unique } from 'drizzle-orm/pg-core';

/** "Day 1": a brand's first 100 distinct buyers (migration 276, api-server lib/dayOne.ts). */
export const brandDayOneBuyers = pgTable('brand_day_one_buyers', {
  sellerId: text('seller_id').notNull(),
  buyerId: text('buyer_id').notNull(),
  rank: integer('rank').notNull(),
  orderId: uuid('order_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.sellerId, t.buyerId] }),
  rankUniq: unique('brand_day_one_buyers_seller_rank_unique').on(t.sellerId, t.rank),
  buyerIdx: index('brand_day_one_buyers_buyer_idx').on(t.buyerId, t.createdAt),
}));
