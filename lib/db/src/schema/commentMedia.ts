import { pgTable, uuid, text, timestamp, integer, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { postComments } from './index';

/**
 * Photo attached to a post comment or reply (migration 300_f6_comment-photos).
 *
 * A row is written by the moderated upload route (POST
 * /api/comment-media/upload) with `comment_id` NULL, and is attached when the
 * same person posts a comment with that `media` id. A comment can only carry a
 * photo this server stored and screened, never an arbitrary URL.
 */
export const postCommentMedia = pgTable('post_comment_media', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  ownerId:              text('owner_id').notNull(),
  commentId:            uuid('comment_id').references(() => postComments.id, { onDelete: 'cascade' }),
  url:                  text('url').notNull(),
  width:                integer('width').notNull(),
  height:               integer('height').notNull(),
  // Upload screening verdict: 'allow' | 'skipped' | 'hold' (rejects never get a row).
  moderationVerdict:    text('moderation_verdict').notNull().default('allow'),
  moderationCategories: text('moderation_categories').array().notNull().default([]),
  unverified:           boolean('unverified').notNull().default(false),
  createdAt:            timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  attachedAt:           timestamp('attached_at', { withTimezone: true }),
}, (t) => ({
  commentUniq: uniqueIndex('post_comment_media_comment_uniq').on(t.commentId),
  ownerIdx:    index('post_comment_media_owner_idx').on(t.ownerId, t.createdAt),
}));
