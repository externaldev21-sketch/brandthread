-- Persist the complete buyer return request and granular push preferences.

ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS evidence_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS requested_items JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
