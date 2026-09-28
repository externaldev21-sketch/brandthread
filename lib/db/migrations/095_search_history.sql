-- Migration 095: per-user search history, server-side (Search rebuild —
-- PR C). Previously purely local AsyncStorage on the buyer-search screen;
-- the owner asked for it to persist server-side per user instead. One row
-- per (user, term); a repeat search bumps searched_at via upsert rather
-- than creating a duplicate, matching recently_viewed_products' pattern.

CREATE TABLE IF NOT EXISTS search_history (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT        NOT NULL,
  term         TEXT        NOT NULL,
  searched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS search_history_user_term_unique
  ON search_history (user_id, LOWER(term));

CREATE INDEX IF NOT EXISTS search_history_user_searched_at_idx
  ON search_history (user_id, searched_at DESC);
