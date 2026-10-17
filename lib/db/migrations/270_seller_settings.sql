-- 270: seller_settings — per-account preferences blob.
-- GET/PATCH /api/seller/settings (seller-settings-route.ts) has read and
-- upserted this table for a long time, but no migration or drizzle schema
-- ever created it, so every read/write failed. It now also backs the AI
-- Settings screen (settings->'ai') and Customer privacy
-- (settings->'customerPrivacy').
CREATE TABLE IF NOT EXISTS seller_settings (
  owner_id   TEXT PRIMARY KEY,
  settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
