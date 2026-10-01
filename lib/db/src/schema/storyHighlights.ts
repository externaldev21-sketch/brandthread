/**
 * Close Friends list, story highlights and the private story archive.
 *
 * - `close_friends`: the author's audience list for Close Friends stories
 *   (stories.privacy_visibility = 'close_friends').
 * - `story_highlights` / `story_highlight_items`: profile highlights. Items hold
 *   a snapshot of the story's media (plus the audience it was posted to) so a
 *   highlight survives the story's 24 h expiry. The story row is hard-deleted
 *   by the cleanup job, so `story_id` is a plain column, not a foreign key.
 * - `story_archive`: author-only copy of a story written when it expires
 *   (the cleanup job never deletes the media objects), so past stories can
 *   still be added to a highlight.
 */
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const closeFriends = pgTable('close_friends', {
  // Private-account migration 118 creates the shared table with owner_id;
  // map the story API's established userId property to that physical column.
  userId:    text('owner_id').notNull(),
  friendId:  text('friend_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  pk:        primaryKey({ columns: [t.userId, t.friendId] }),
  friendIdx: index('close_friends_friend_idx').on(t.friendId),
}));

export const storyHighlights = pgTable('story_highlights', {
  id:         uuid('id').primaryKey().defaultRandom(),
  userId:     text('user_id').notNull(),
  title:      text('title').notNull().default(''),
  coverUrl:   text('cover_url'),
  coverEmoji: text('cover_emoji'),
  coverColor: text('cover_color'),
  position:   integer('position').notNull().default(0),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
  updatedAt:  timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  userIdx: index('story_highlights_user_idx').on(t.userId, t.position),
}));

export const storyHighlightItems = pgTable('story_highlight_items', {
  id:             uuid('id').primaryKey().defaultRandom(),
  highlightId:    uuid('highlight_id').notNull().references(() => storyHighlights.id, { onDelete: 'cascade' }),
  storyId:        uuid('story_id'),
  media:          jsonb('media').$type<unknown[]>().notNull().default([]),
  /** 'public' | 'friends' | 'close_friends' — the audience the story was posted to. */
  visibility:     text('visibility').notNull().default('public'),
  storyCreatedAt: timestamp('story_created_at'),
  position:       integer('position').notNull().default(0),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  highlightIdx: index('story_highlight_items_highlight_idx').on(t.highlightId, t.position),
  storyIdx:     index('story_highlight_items_story_idx').on(t.storyId),
  uniq:         uniqueIndex('story_highlight_items_unique').on(t.highlightId, t.storyId),
}));

export const storyArchive = pgTable('story_archive', {
  storyId:         uuid('story_id').primaryKey(),
  authorId:        text('author_id').notNull(),
  media:           jsonb('media').$type<unknown[]>().notNull().default([]),
  visibility:      text('visibility').notNull().default('public'),
  storyCreatedAt:  timestamp('story_created_at').notNull(),
  archivedAt:      timestamp('archived_at').defaultNow().notNull(),
}, (t) => ({
  authorIdx: index('story_archive_author_idx').on(t.authorId, t.storyCreatedAt),
}));
