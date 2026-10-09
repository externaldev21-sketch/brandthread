/**
 * Live commerce: scheduled lives and follower reminders (migration 121).
 * The pinned product and live-scoped discount columns live on the existing
 * `live_streams` / `discount_codes` tables (migrations 120 / 122).
 */
import { index, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const scheduledLives = pgTable('scheduled_lives', {
  id:                uuid('id').primaryKey().defaultRandom(),
  sellerId:          text('seller_id').notNull(),
  title:             text('title').notNull(),
  description:       text('description'),
  startsAt:          timestamp('starts_at', { withTimezone: true }).notNull(),
  productTags:       jsonb('product_tags').$type<any[]>().notNull().default([]),
  /** 'scheduled' | 'live' | 'cancelled' */
  status:            text('status').notNull().default('scheduled'),
  streamId:          uuid('stream_id'),
  reminderSentAt:    timestamp('reminder_sent_at', { withTimezone: true }),
  startedNotifiedAt: timestamp('started_notified_at', { withTimezone: true }),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  statusStartsIdx: index('scheduled_lives_status_starts_idx').on(t.status, t.startsAt),
  sellerIdx:       index('scheduled_lives_seller_idx').on(t.sellerId, t.status, t.startsAt),
}));

export const scheduledLiveReminders = pgTable('scheduled_live_reminders', {
  scheduledLiveId: uuid('scheduled_live_id').notNull().references(() => scheduledLives.id, { onDelete: 'cascade' }),
  userId:          text('user_id').notNull(),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk:      primaryKey({ columns: [t.scheduledLiveId, t.userId] }),
  userIdx: index('scheduled_live_reminders_user_idx').on(t.userId),
}));
