-- 273: Per-seller secret product feed URL (Meta / TikTok catalog data feeds).
-- One row per seller; regenerating replaces the token so older URLs stop working.
CREATE TABLE IF NOT EXISTS product_feeds (
  seller_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta_fetched_at TIMESTAMPTZ,
  tiktok_fetched_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS product_feeds_token_unique ON product_feeds (token);
