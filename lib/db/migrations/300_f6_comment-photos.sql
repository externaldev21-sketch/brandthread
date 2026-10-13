-- ─── 300_f6: photo replies in comments ───────────────────────────────────────
-- One moderated photo per post comment / reply. Rows are created by the
-- upload route with comment_id NULL and attached when the comment is posted.
CREATE TABLE IF NOT EXISTS post_comment_media (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              TEXT NOT NULL,
  comment_id            UUID REFERENCES post_comments(id) ON DELETE CASCADE,
  url                   TEXT NOT NULL,
  width                 INTEGER NOT NULL,
  height                INTEGER NOT NULL,
  moderation_verdict    TEXT NOT NULL DEFAULT 'allow',
  moderation_categories TEXT[] NOT NULL DEFAULT '{}',
  unverified            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attached_at           TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS post_comment_media_comment_uniq
  ON post_comment_media (comment_id);
CREATE INDEX IF NOT EXISTS post_comment_media_owner_idx
  ON post_comment_media (owner_id, created_at);
