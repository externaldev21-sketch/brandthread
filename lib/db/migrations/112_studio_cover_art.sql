-- 112: Studio carousel "album cover" art — generated chrome/black/silver hero
-- photographs per card, one row per card id, candidates kept even after a pick.
CREATE TABLE IF NOT EXISTS studio_cover_art (
  card_id             TEXT PRIMARY KEY,
  candidates          JSONB NOT NULL DEFAULT '[]',
  chosen_object_path  TEXT,
  chosen_blurhash     TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
