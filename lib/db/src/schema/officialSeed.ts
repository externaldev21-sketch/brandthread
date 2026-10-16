import { pgTable, uuid, text, integer, timestamp, primaryKey } from 'drizzle-orm/pg-core';

// ─── New-user seeding of @brandthread official Threads (migration 270) ───────
// `post_id` has an ON DELETE CASCADE foreign key to posts in the SQL
// migration; it is not repeated here so this file does not import index.ts.

/** An official Thread a viewer has actually had on screen. Seen posts are never seeded again. */
export const officialSeedImpressions = pgTable('official_seed_impressions', {
  userId: text('user_id').notNull(),
  postId: uuid('post_id').notNull(),
  seenAt: timestamp('seen_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.postId] }),
}));

/** Threads viewed by a user while inside the new-user seeding window. */
export const officialSeedProgress = pgTable('official_seed_progress', {
  userId:        text('user_id').primaryKey(),
  threadsViewed: integer('threads_viewed').notNull().default(0),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
