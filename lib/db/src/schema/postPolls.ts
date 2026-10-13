/**
 * Polls on Threads (posts.surface = 'thread'), X/Twitter-style: 2-4 choices,
 * a poll length (5 minutes to 7 days, default 1 day), one vote per person,
 * no changing it. The poll clock starts when the post goes live (published_at,
 * or scheduled_at for a scheduled post), so the end time is derived at read
 * time from `duration_minutes` rather than stored (see api-server
 * lib/postPolls.ts). Both tables cascade-delete with their post.
 */
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { posts } from './index';

export const postPolls = pgTable('post_polls', {
  postId:          uuid('post_id').primaryKey().references(() => posts.id, { onDelete: 'cascade' }),
  /** 2-4 choice labels, in display order. */
  options:         jsonb('options').$type<string[]>().notNull(),
  durationMinutes: integer('duration_minutes').notNull().default(1440),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const postPollVotes = pgTable('post_poll_votes', {
  postId:      uuid('post_id').notNull().references(() => postPolls.postId, { onDelete: 'cascade' }),
  userId:      text('user_id').notNull(),
  optionIndex: integer('option_index').notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk:        primaryKey({ columns: [t.postId, t.userId] }),
  optionIdx: index('post_poll_votes_option_idx').on(t.postId, t.optionIndex),
}));
