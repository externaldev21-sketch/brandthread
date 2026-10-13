/**
 * Live auctions for 1-of-1 pieces (F6 live-auctions, migration
 * 300_f6_live-auctions.sql). Whatnot-style: the host starts a short auction
 * on a product with exactly one unit; viewers bid; the winner pays through
 * the normal checkout at the winning price (live_auction_checkouts links the
 * checkout back to the auction so the paid order is recorded on it).
 */
import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const liveAuctions = pgTable('live_auctions', {
  id:               uuid('id').primaryKey().defaultRandom(),
  streamId:         uuid('stream_id').notNull(),
  sellerId:         text('seller_id').notNull(),
  productId:        uuid('product_id').notNull(),
  variantId:        uuid('variant_id'),
  productName:      text('product_name').notNull().default(''),
  imageUri:         text('image_uri'),
  startingBidCents: integer('starting_bid_cents').notNull(),
  /** Null until the first bid. */
  currentBidCents:  integer('current_bid_cents'),
  leaderUserId:     text('leader_user_id'),
  bidCount:         integer('bid_count').notNull().default(0),
  durationSeconds:  integer('duration_seconds').notNull(),
  /** Whatnot "sudden death": no anti-snipe extension. */
  suddenDeath:      boolean('sudden_death').notNull().default(false),
  endsAt:           timestamp('ends_at', { withTimezone: true }).notNull(),
  /** 'open' | 'sold' | 'unsold' | 'cancelled' */
  status:           text('status').notNull().default('open'),
  winnerUserId:     text('winner_user_id'),
  winnerOrderId:    uuid('winner_order_id'),
  /** The winner's checkout honours the winning price until then. */
  payBy:            timestamp('pay_by', { withTimezone: true }),
  settledAt:        timestamp('settled_at', { withTimezone: true }),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  oneOpenPerStream: uniqueIndex('live_auctions_one_open_per_stream').on(t.streamId).where(sql`status = 'open'`),
  streamIdx:        index('live_auctions_stream_idx').on(t.streamId, t.createdAt),
  dueIdx:           index('live_auctions_due_idx').on(t.status, t.endsAt),
  productIdx:       index('live_auctions_product_idx').on(t.productId, t.status),
}));

export const liveAuctionBids = pgTable('live_auction_bids', {
  id:          uuid('id').primaryKey().defaultRandom(),
  auctionId:   uuid('auction_id').notNull(),
  bidderId:    text('bidder_id').notNull(),
  amountCents: integer('amount_cents').notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  auctionIdx: index('live_auction_bids_auction_idx').on(t.auctionId, t.createdAt),
}));

export const liveAuctionCheckouts = pgTable('live_auction_checkouts', {
  checkoutSessionId: uuid('checkout_session_id').primaryKey(),
  auctionId:         uuid('auction_id').notNull(),
  buyerId:           text('buyer_id').notNull(),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  auctionIdx: index('live_auction_checkouts_auction_idx').on(t.auctionId),
}));
