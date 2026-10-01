/**
 * Hashtags: a normalised index of the tags on posts (post_hashtags) and the
 * tags people follow (hashtag_follows).
 *
 * `posts.hashtags` stays the source of truth written by the clients; every
 * create/update on /api/posts re-syncs this index. Post status and moderation
 * are NOT mirrored here — reads join `posts` and apply publicPostCondition().
 * `created_at` copies the post's created_at so (tag, created_at desc) serves
 * "recent posts for a tag" straight from the index.
 */
import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { posts } from './index';

export const postHashtags = pgTable('post_hashtags', {
  postId:    uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  tag:       text('tag').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk:          primaryKey({ columns: [t.postId, t.tag] }),
  tagRecentIdx: index('post_hashtags_tag_created_idx').on(t.tag, t.createdAt.desc()),
}));

export const hashtagFollows = pgTable('hashtag_follows', {
  userId:    text('user_id').notNull(),
  tag:       text('tag').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk:      primaryKey({ columns: [t.userId, t.tag] }),
  userIdx: index('hashtag_follows_user_idx').on(t.userId, t.createdAt.desc()),
  tagIdx:  index('hashtag_follows_tag_idx').on(t.tag),
}));
