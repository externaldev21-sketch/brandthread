import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Per-account AI assistant settings (migration 116) — the toggles on the
 * seller's AI Settings screen. One row per user; `settings` holds the
 * normalized settings object (see artifacts/api-server/src/lib/aiSettings.ts
 * for the shape and the normalization applied before every write).
 */
export const aiAssistantSettings = pgTable("ai_assistant_settings", {
  userId: text("user_id").primaryKey(),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
