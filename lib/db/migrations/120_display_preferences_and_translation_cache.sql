-- ─── Migration 120: Display preferences + caption translation cache ───────
-- Server-side source of truth for the buyer settings rows "Translation
-- language", "Auto-translate captions" (Language), "Text size" and "High
-- contrast icons" (Accessibility). Read/written by GET/PATCH
-- /api/display-preferences. translation_cache backs POST /api/translate so a
-- caption already translated into a language never costs another model call.
-- Additive only.

CREATE TABLE IF NOT EXISTS user_display_preferences (
  user_id                 TEXT PRIMARY KEY,
  -- ISO 639-1 code captions are translated into
  translation_language    TEXT NOT NULL DEFAULT 'en',
  auto_translate_captions BOOLEAN NOT NULL DEFAULT FALSE,
  -- 'default' | 'large' | 'larger'
  text_size               TEXT NOT NULL DEFAULT 'default',
  high_contrast_icons     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT user_display_preferences_text_size_valid
    CHECK (text_size IN ('default', 'large', 'larger'))
);

-- One row per (normalised source text, target language): sha256 key.
CREATE TABLE IF NOT EXISTS translation_cache (
  cache_key         TEXT PRIMARY KEY,
  target_language   TEXT NOT NULL,
  detected_language TEXT NOT NULL,
  translated_text   TEXT NOT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS translation_cache_created_at_idx
  ON translation_cache (created_at);
