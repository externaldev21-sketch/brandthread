-- ─── Migration 117: Account interaction settings + hidden story viewers ────
-- Server-side source of truth for the buyer "Comments", "Sharing and
-- remixes" and "Story and live" settings rows. Each value is enforced by the
-- API (comments: POST /api/posts/:postId/comments; reposts: POST
-- /api/posts/:id/interact; downloads: GET /api/interaction-settings/posts/
-- :postId/download; hidden story viewers: every story read path in
-- routes/social.ts and routes/story-mentions.ts). Additive only.

CREATE TABLE IF NOT EXISTS user_interaction_settings (
  user_id          TEXT PRIMARY KEY,
  -- 'everyone' | 'following' (people this account follows) | 'nobody'
  comment_audience TEXT NOT NULL DEFAULT 'everyone',
  allow_reposts    BOOLEAN NOT NULL DEFAULT TRUE,
  allow_downloads  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT user_interaction_settings_comment_audience_valid
    CHECK (comment_audience IN ('everyone', 'following', 'nobody'))
);

-- People an account hides its stories from ("Hide story from").
CREATE TABLE IF NOT EXISTS story_hidden_viewers (
  owner_id       TEXT NOT NULL,
  hidden_user_id TEXT NOT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, hidden_user_id)
);

CREATE INDEX IF NOT EXISTS story_hidden_viewers_hidden_user_idx
  ON story_hidden_viewers (hidden_user_id);
