import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Per-account display preferences (migration 120): caption translation
 * language + auto-translate, in-app text size and high-contrast icons.
 * See artifacts/api-server/src/lib/displayPreferences.ts.
 */
export const userDisplayPreferences = pgTable("user_display_preferences", {
  userId: text("user_id").primaryKey(),
  translationLanguage: text("translation_language").notNull().default("en"),
  autoTranslateCaptions: boolean("auto_translate_captions").notNull().default(false),
  /** 'default' | 'large' | 'larger' */
  textSize: text("text_size").notNull().default("default"),
  highContrastIcons: boolean("high_contrast_icons").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Translations already produced by POST /api/translate (migration 120).
 * cache_key = sha256(target language + NUL + normalised source text).
 */
export const translationCache = pgTable("translation_cache", {
  cacheKey: text("cache_key").primaryKey(),
  targetLanguage: text("target_language").notNull(),
  detectedLanguage: text("detected_language").notNull(),
  translatedText: text("translated_text").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  createdAtIdx: index("translation_cache_created_at_idx").on(table.createdAt),
}));
