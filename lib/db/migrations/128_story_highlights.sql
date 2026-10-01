-- ─── Migration 128: story highlights + story archive ─────────────────────────
-- story_highlight_items.story_id is deliberately NOT a foreign key: items keep
-- a media snapshot and outlive the story row (hard-deleted after 24 h).
-- story_archive is an author-only copy written by the story cleanup job.
CREATE TABLE IF NOT EXISTS story_highlights (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  cover_url   TEXT,
  cover_emoji TEXT,
  cover_color TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS story_highlights_user_idx ON story_highlights (user_id, position);

CREATE TABLE IF NOT EXISTS story_highlight_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  highlight_id     UUID NOT NULL REFERENCES story_highlights(id) ON DELETE CASCADE,
  story_id         UUID,
  media            JSONB NOT NULL DEFAULT '[]'::jsonb,
  visibility       TEXT NOT NULL DEFAULT 'public',
  story_created_at TIMESTAMP,
  position         INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS story_highlight_items_highlight_idx ON story_highlight_items (highlight_id, position);
CREATE INDEX IF NOT EXISTS story_highlight_items_story_idx ON story_highlight_items (story_id);
CREATE UNIQUE INDEX IF NOT EXISTS story_highlight_items_unique ON story_highlight_items (highlight_id, story_id);

CREATE TABLE IF NOT EXISTS story_archive (
  story_id         UUID PRIMARY KEY,
  author_id        TEXT NOT NULL,
  media            JSONB NOT NULL DEFAULT '[]'::jsonb,
  visibility       TEXT NOT NULL DEFAULT 'public',
  story_created_at TIMESTAMP NOT NULL,
  archived_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS story_archive_author_idx ON story_archive (author_id, story_created_at);
