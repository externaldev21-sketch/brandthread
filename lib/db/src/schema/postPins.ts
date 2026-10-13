/**
 * "Pin to your profile" (Instagram pattern): up to 3 of an author's own
 * published posts shown first on their profile grid, newest pin first.
 * One row per pinned post; cascade-deletes with the post.
 */
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { posts } from './index';

export const postPins = pgTable('post_pins', {
  postId:   uuid('post_id').primaryKey().references(() => posts.id, { onDelete: 'cascade' }),
  /** The post's author (pins are owner-only). */
  userId:   text('user_id').notNull(),
  pinnedAt: timestamp('pinned_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('post_pins_user_idx').on(t.userId, t.pinnedAt),
}));
