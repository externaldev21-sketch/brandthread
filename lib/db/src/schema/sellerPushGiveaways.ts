/**
 * Seller follower push broadcasts + giveaways. See migration 123.
 */
import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const sellerPushBroadcasts = pgTable('seller_push_broadcasts', {
  id:             uuid('id').primaryKey().defaultRandom(),
  sellerId:       text('seller_id').notNull(),
  title:          text('title').notNull(),
  body:           text('body').notNull(),
  deeplinkType:   text('deeplink_type'),
  deeplinkId:     text('deeplink_id'),
  status:         text('status').notNull().default('sending'),
  recipientCount: integer('recipient_count').notNull().default(0),
  sentCount:      integer('sent_count').notNull().default(0),
  skippedCount:   integer('skipped_count').notNull().default(0),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt:    timestamp('completed_at', { withTimezone: true }),
}, (t) => ({
  sellerCreatedIdx: index('seller_push_broadcasts_seller_created_idx').on(t.sellerId, t.createdAt),
}));

export const giveaways = pgTable('giveaways', {
  id:          uuid('id').primaryKey().defaultRandom(),
  sellerId:    text('seller_id').notNull(),
  shareCode:   text('share_code').notNull(),
  title:       text('title').notNull(),
  prizeText:   text('prize_text').notNull(),
  productId:   uuid('product_id'),
  postId:      uuid('post_id'),
  startsAt:    timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt:      timestamp('ends_at', { withTimezone: true }).notNull(),
  rulesText:   text('rules_text').notNull(),
  eligibility: text('eligibility').notNull().default(''),
  region:      text('region').notNull().default(''),
  winnerCount: integer('winner_count').notNull().default(1),
  status:      text('status').notNull().default('open'),
  drawnAt:     timestamp('drawn_at', { withTimezone: true }),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  shareCodeIdx: uniqueIndex('giveaways_share_code_idx').on(t.shareCode),
  sellerIdx:    index('giveaways_seller_idx').on(t.sellerId, t.createdAt),
}));

export const giveawayEntries = pgTable('giveaway_entries', {
  id:             uuid('id').primaryKey().defaultRandom(),
  giveawayId:     uuid('giveaway_id').notNull().references(() => giveaways.id, { onDelete: 'cascade' }),
  userId:         text('user_id').notNull(),
  followed:       boolean('followed').notNull().default(false),
  commented:      boolean('commented').notNull().default(false),
  commentId:      uuid('comment_id'),
  eligible:       boolean('eligible').notNull().default(false),
  excludedReason: text('excluded_reason'),
  materialisedAt: timestamp('materialised_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uniqueUser:   unique('giveaway_entries_giveaway_id_user_id_key').on(t.giveawayId, t.userId),
  eligibleIdx:  index('giveaway_entries_giveaway_eligible_idx').on(t.giveawayId, t.eligible),
}));

export const giveawayDraws = pgTable('giveaway_draws', {
  id:            uuid('id').primaryKey().defaultRandom(),
  giveawayId:    uuid('giveaway_id').notNull().references(() => giveaways.id, { onDelete: 'cascade' }),
  drawNumber:    integer('draw_number').notNull(),
  eligibleCount: integer('eligible_count').notNull(),
  eligibleHash:  text('eligible_hash').notNull(),
  winnerIds:     jsonb('winner_ids').$type<string[]>().notNull().default([]),
  reason:        text('reason'),
  drawnBy:       text('drawn_by').notNull(),
  drawnAt:       timestamp('drawn_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uniqueNumber: unique('giveaway_draws_giveaway_id_draw_number_key').on(t.giveawayId, t.drawNumber),
}));

export const giveawayWinners = pgTable('giveaway_winners', {
  id:               uuid('id').primaryKey().defaultRandom(),
  giveawayId:       uuid('giveaway_id').notNull().references(() => giveaways.id, { onDelete: 'cascade' }),
  drawId:           uuid('draw_id').notNull().references(() => giveawayDraws.id, { onDelete: 'cascade' }),
  userId:           text('user_id').notNull(),
  position:         integer('position').notNull(),
  status:           text('status').notNull().default('active'),
  replacedReason:   text('replaced_reason'),
  replacedAt:       timestamp('replaced_at', { withTimezone: true }),
  replacesWinnerId: uuid('replaces_winner_id'),
  notifiedAt:       timestamp('notified_at', { withTimezone: true }),
  shippedAt:        timestamp('shipped_at', { withTimezone: true }),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  giveawayIdx:  index('giveaway_winners_giveaway_idx').on(t.giveawayId, t.status),
  activeUserIdx: uniqueIndex('giveaway_winners_active_user_idx').on(t.giveawayId, t.userId).where(sql`status = 'active'`),
}));
