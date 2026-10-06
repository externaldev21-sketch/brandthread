import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Per-account interaction settings (migration 117) — who may comment on the
 * account's posts, and whether others may repost or download its content.
 * Enforced server-side; see artifacts/api-server/src/lib/interactionSettings.ts.
 */
export const userInteractionSettings = pgTable("user_interaction_settings", {
  userId: text("user_id").primaryKey(),
  /** 'everyone' | 'following' | 'nobody' */
  commentAudience: text("comment_audience").notNull().default("everyone"),
  allowReposts: boolean("allow_reposts").notNull().default(true),
  allowDownloads: boolean("allow_downloads").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** "Hide story from" — people an account hides its stories from (migration 117). */
export const storyHiddenViewers = pgTable("story_hidden_viewers", {
  ownerId: text("owner_id").notNull(),
  hiddenUserId: text("hidden_user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.ownerId, t.hiddenUserId] }),
  hiddenUserIdx: index("story_hidden_viewers_hidden_user_idx").on(t.hiddenUserId),
}));

/**
 * Free-form seller settings (migration 117 creates the table the
 * /api/seller/settings route has always used): store language, checkout mode,
 * tipping. See artifacts/api-server/src/lib/sellerCheckoutSettings.ts.
 */
export const sellerSettings = pgTable("seller_settings", {
  ownerId: text("owner_id").primaryKey(),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
