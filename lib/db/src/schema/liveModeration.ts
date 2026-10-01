/** Live chat moderation + co-host tables (migrations 125, 126). */
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const liveModerationSettings = pgTable('live_moderation_settings', {
  streamId:        uuid('stream_id').primaryKey(),
  bannedWords:     jsonb('banned_words').$type<string[]>().notNull().default([]),
  slowModeSeconds: integer('slow_mode_seconds').notNull().default(0),
  pinnedCommentId: uuid('pinned_comment_id'),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const liveStreamRestrictions = pgTable('live_stream_restrictions', {
  streamId:  uuid('stream_id').notNull(),
  userId:    text('user_id').notNull(),
  /** 'mute' | 'ban' */
  kind:      text('kind').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk:        primaryKey({ columns: [t.streamId, t.userId] }),
  streamIdx: index('live_stream_restrictions_stream_idx').on(t.streamId, t.kind),
}));

export const sellerLiveModerationDefaults = pgTable('seller_live_moderation_defaults', {
  sellerId:        text('seller_id').primaryKey(),
  bannedWords:     jsonb('banned_words').$type<string[]>().notNull().default([]),
  slowModeSeconds: integer('slow_mode_seconds').notNull().default(0),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const liveCohosts = pgTable('live_cohosts', {
  id:          uuid('id').primaryKey().defaultRandom(),
  streamId:    uuid('stream_id').notNull(),
  hostId:      text('host_id').notNull(),
  cohostId:    text('cohost_id').notNull(),
  /** 'invited' | 'accepted' | 'declined' | 'cancelled' | 'removed' | 'left' */
  status:      text('status').notNull().default('invited'),
  agoraUid:    integer('agora_uid'),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  endedAt:     timestamp('ended_at', { withTimezone: true }),
}, (t) => ({
  cohostStatusIdx: index('live_cohosts_cohost_status_idx').on(t.cohostId, t.status),
  streamIdx:       index('live_cohosts_stream_idx').on(t.streamId, t.status),
  openUnique:      uniqueIndex('live_cohosts_open_unique').on(t.streamId, t.cohostId)
    .where(sql`status IN ('invited', 'accepted')`),
}));
