import { pgTable, uuid, text, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { postComments } from './index';

/**
 * Verified @mentions of a post comment (migration 116): one row per
 * (comment, mentioned person), resolved server-side from the comment body.
 */
export const commentMentions = pgTable('comment_mentions', {
  commentId:       uuid('comment_id').notNull().references(() => postComments.id, { onDelete: 'cascade' }),
  mentionedUserId: text('mentioned_user_id').notNull(),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk:           primaryKey({ columns: [t.commentId, t.mentionedUserId] }),
  mentionedIdx: index('comment_mentions_user_idx').on(t.mentionedUserId, t.createdAt),
}));
