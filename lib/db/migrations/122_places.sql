-- 122: Places + posts.place_id (location tags and location pages).
CREATE TABLE IF NOT EXISTS places (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  normalized_name   TEXT NOT NULL,
  city              TEXT,
  region            TEXT,
  country           TEXT,
  lat               NUMERIC(9,6),
  lng               NUMERIC(9,6),
  dedupe_key        TEXT NOT NULL,
  provider          TEXT,
  provider_place_id TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS places_dedupe_key_unique ON places (dedupe_key);
CREATE UNIQUE INDEX IF NOT EXISTS places_provider_unique ON places (provider, provider_place_id) WHERE provider_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS places_normalized_name_idx ON places (normalized_name);
CREATE INDEX IF NOT EXISTS places_normalized_name_prefix_idx ON places (normalized_name text_pattern_ops);

ALTER TABLE posts ADD COLUMN IF NOT EXISTS place_id UUID REFERENCES places(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS posts_place_created_idx ON posts (place_id, created_at DESC) WHERE place_id IS NOT NULL;
