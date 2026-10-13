/**
 * Live shopping extras (F6 live-commerce, migration 300_f6_live-commerce.sql):
 *
 *  - live_stream_orders: which checkout / order came from which live, so a
 *    paid order can be announced in that live ("Ana just bought …").
 *  - live_cohost_products: products an accepted co-host adds to the host's
 *    live bag (bought from the co-host's own store).
 *  - live_gift_platform_fees: Brandthread's cut of each Thread Cash live gift.
 *    Thread Cash is not part of the double-entry money ledger (see
 *    lib/money/ledger.ts), so the platform's share is recorded here, one row
 *    per gift.
 */
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const liveStreamOrders = pgTable('live_stream_orders', {
  id:                uuid('id').primaryKey().defaultRandom(),
  checkoutSessionId: uuid('checkout_session_id').notNull(),
  streamId:          uuid('stream_id').notNull(),
  buyerId:           text('buyer_id').notNull(),
  sellerId:          text('seller_id').notNull(),
  orderId:           uuid('order_id'),
  announcedAt:       timestamp('announced_at', { withTimezone: true }),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  checkoutUnique: uniqueIndex('live_stream_orders_checkout_unique').on(t.checkoutSessionId),
  streamIdx:      index('live_stream_orders_stream_idx').on(t.streamId, t.announcedAt),
}));

export const liveCohostProducts = pgTable('live_cohost_products', {
  id:        uuid('id').primaryKey().defaultRandom(),
  streamId:  uuid('stream_id').notNull(),
  cohostId:  text('cohost_id').notNull(),
  productId: uuid('product_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uniq:      uniqueIndex('live_cohost_products_unique').on(t.streamId, t.cohostId, t.productId),
  streamIdx: index('live_cohost_products_stream_idx').on(t.streamId),
}));

export const liveGiftPlatformFees = pgTable('live_gift_platform_fees', {
  id:            uuid('id').primaryKey().defaultRandom(),
  /** The buyer's 'live_gift_sent' thread_cash_entries row. */
  giftEntryId:   uuid('gift_entry_id').notNull(),
  streamId:      text('stream_id').notNull(),
  buyerId:       text('buyer_id').notNull(),
  sellerId:      text('seller_id').notNull(),
  grossCents:    integer('gross_cents').notNull(),
  feeBps:        integer('fee_bps').notNull(),
  feeCents:      integer('fee_cents').notNull(),
  netCents:      integer('net_cents').notNull(),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  giftUnique: uniqueIndex('live_gift_platform_fees_gift_unique').on(t.giftEntryId),
  streamIdx:  index('live_gift_platform_fees_stream_idx').on(t.streamId),
}));
