-- 112: Tunable For You ranking weights + per-buyer "not interested" hides.
CREATE TABLE IF NOT EXISTS ranking_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feed_not_interested (
  user_id    TEXT NOT NULL,
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  seller_id  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS feed_not_interested_user_idx ON feed_not_interested (user_id, created_at);
