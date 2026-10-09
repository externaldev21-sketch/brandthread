-- ─── Migration 117: structured comment @mentions ─────────────────────────────
CREATE TABLE IF NOT EXISTS comment_mentions (
  comment_id UUID NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
  mentioned_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS comment_mentions_user_idx
  ON comment_mentions (mentioned_user_id, created_at);
