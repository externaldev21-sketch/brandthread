/**
 * Ranking tunables + per-buyer "not interested" hides for the For You feed.
 */
import { index, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { posts } from './index';

/** Key/value store for tunable ranking weights (key 'ranking_weights'). */
export const rankingConfig = pgTable('ranking_config', {
  key:       text('key').primaryKey(),
  value:     jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Posts a buyer marked "Not interested" — excluded from their For You candidates. */
export const feedNotInterested = pgTable('feed_not_interested', {
  userId:    text('user_id').notNull(),
  postId:    uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  sellerId:  text('seller_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.postId] }),
  userIdx: index('feed_not_interested_user_idx').on(t.userId, t.createdAt),
}));
