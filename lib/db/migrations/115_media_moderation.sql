-- 115: Automatic media screening results + moderation queue audit.
-- One row per screened item that was held/rejected (allowed items are not
-- stored). No raw images are kept: only verdict, categories, scores and the
-- media reference (URL / object path) the moderator needs to look at it.
-- stories.moderation_status already allows 'held' (migration 085).
CREATE TABLE IF NOT EXISTS media_moderation_results (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type      TEXT NOT NULL,                 -- post | story | comment | upload
  target_id        TEXT NOT NULL,
  owner_id         TEXT,
  provider         TEXT NOT NULL,
  verdict          TEXT NOT NULL,                 -- hold | reject
  categories       JSONB NOT NULL DEFAULT '[]'::jsonb,
  scores           JSONB NOT NULL DEFAULT '{}'::jsonb,
  max_score        REAL NOT NULL DEFAULT 0,
  frames_checked   INTEGER NOT NULL DEFAULT 0,
  priority         TEXT NOT NULL DEFAULT 'normal', -- normal | high
  media_refs       JSONB NOT NULL DEFAULT '[]'::jsonb,
  surface          TEXT,
  reviewed_by      TEXT,
  reviewed_at      TIMESTAMPTZ,
  review_action    TEXT,                          -- approve | remove
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS media_moderation_results_target_idx ON media_moderation_results (target_type, target_id);
CREATE INDEX IF NOT EXISTS media_moderation_results_review_idx ON media_moderation_results (verdict, reviewed_at, created_at);
