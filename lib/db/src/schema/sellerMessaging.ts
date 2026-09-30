import { boolean, index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { conversations } from './conversations';

/** Seller canned replies (migration 140). */
export const sellerQuickReplies = pgTable('seller_quick_replies', {
  id:        uuid('id').primaryKey().defaultRandom(),
  sellerId:  text('seller_id').notNull(),
  title:     text('title').notNull(),
  body:      text('body').notNull(),
  shortcut:  text('shortcut'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sellerIdx: index('seller_quick_replies_seller_idx').on(t.sellerId, t.createdAt),
}));

/** Seller away auto-reply settings (migration 141). */
export const sellerAwaySettings = pgTable('seller_away_settings', {
  sellerId:    text('seller_id').primaryKey(),
  enabled:     boolean('enabled').notNull().default(false),
  message:     text('message').notNull().default(''),
  mode:        text('mode').notNull().default('always'),
  timezone:    text('timezone').notNull().default('UTC'),
  openDays:    integer('open_days').notNull().default(62),
  openMinute:  integer('open_minute').notNull().default(540),
  closeMinute: integer('close_minute').notNull().default(1020),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Once-per-window dedupe log for away auto-replies (migration 142). */
export const awayAutoReplies = pgTable('away_auto_replies', {
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  windowKey:      text('window_key').notNull(),
  sellerId:       text('seller_id').notNull(),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.conversationId, t.windowKey] }),
}));
