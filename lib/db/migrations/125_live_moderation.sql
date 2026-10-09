-- ─── Migration 125: Live chat moderation ─────────────────────────────────────
-- Per-stream settings (banned words, slow mode, pinned comment), per-stream
-- mute/ban lists, a seller-level default settings row that seeds new streams,
-- and a soft-remove marker on live_comments. Everything is additive; a stream
-- with no rows here behaves exactly as before.

CREATE TABLE IF NOT EXISTS live_moderation_settings (
  stream_id          UUID PRIMARY KEY REFERENCES live_streams(id) ON DELETE CASCADE,
  banned_words       JSONB NOT NULL DEFAULT '[]'::jsonb,
  slow_mode_seconds  INTEGER NOT NULL DEFAULT 0,
  pinned_comment_id  UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS live_stream_restrictions (
  stream_id   UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,              -- 'mute' | 'ban'
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (stream_id, user_id)
);
CREATE INDEX IF NOT EXISTS live_stream_restrictions_stream_idx
  ON live_stream_restrictions (stream_id, kind);

CREATE TABLE IF NOT EXISTS seller_live_moderation_defaults (
  seller_id          TEXT PRIMARY KEY,
  banned_words       JSONB NOT NULL DEFAULT '[]'::jsonb,
  slow_mode_seconds  INTEGER NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE live_comments ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
