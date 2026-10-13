/**
 * Fits (F6 items 80-82). Three side tables keyed off `posts`, so nothing new
 * is added to the posts row itself:
 *
 *   post_stitches   — a post that stitches a clip of another post (TikTok
 *                     "Stitch with @user"). The stitch is a normal post with
 *                     the author's own media; this row carries the attribution
 *                     and which part of the original was used.
 *   post_fit_checks — a buyer's profile post linked to a product they bought.
 *                     Purchase is verified server-side against orders; this
 *                     never loosens post_tagged_products (seller-only tags).
 *   repost_requests — a brand asking a buyer for permission to repost their
 *                     fit check. Approval creates the brand's normal repost.
 */
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { posts, products } from './index';

export const postStitches = pgTable('post_stitches', {
  postId:         uuid('post_id').primaryKey().references(() => posts.id, { onDelete: 'cascade' }),
  // SET NULL: deleting the original must not delete the stitches of it.
  sourcePostId:   uuid('source_post_id').references(() => posts.id, { onDelete: 'set null' }),
  sourceAuthorId: text('source_author_id').notNull(),
  clipStartMs:    integer('clip_start_ms').notNull().default(0),
  clipEndMs:      integer('clip_end_ms').notNull().default(0),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  sourceIdx: index('post_stitches_source_idx').on(t.sourcePostId, t.createdAt.desc()),
}));

export const postFitChecks = pgTable('post_fit_checks', {
  postId:    uuid('post_id').primaryKey().references(() => posts.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  buyerId:   text('buyer_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  productIdx: index('post_fit_checks_product_idx').on(t.productId, t.createdAt.desc()),
  buyerIdx:   index('post_fit_checks_buyer_idx').on(t.buyerId),
}));

/** 'pending' | 'approved' | 'declined' | 'cancelled' */
export const repostRequests = pgTable('repost_requests', {
  id:                uuid('id').primaryKey().defaultRandom(),
  postId:            uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  requesterSellerId: text('requester_seller_id').notNull(),
  ownerUserId:       text('owner_user_id').notNull(),
  status:            text('status').notNull().default('pending'),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  respondedAt:       timestamp('responded_at', { withTimezone: true }),
}, (t) => ({
  ownerIdx: index('repost_requests_owner_idx').on(t.ownerUserId, t.status, t.createdAt.desc()),
  postSellerIdx: index('repost_requests_post_seller_idx').on(t.postId, t.requesterSellerId),
  // One open request per (post, brand): a second tap while pending is a no-op.
  openUnique: uniqueIndex('repost_requests_open_unique')
    .on(t.postId, t.requesterSellerId)
    .where(sql`status = 'pending'`),
}));
