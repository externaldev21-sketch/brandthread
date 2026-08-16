-- 011: Server-side stories with likes and views
-- Stores buyer + seller stories (24h TTL enforced by expires_at).
-- media column holds the JSON array of StoryMedia slides.

CREATE TABLE IF NOT EXISTS stories (
  id                  UUID    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  author_id           TEXT    NOT NULL,            -- Clerk user ID
  author_name         TEXT    NOT NULL,
  author_handle       TEXT,
  author_initials     TEXT,
  author_color        TEXT,
  author_account_type TEXT    NOT NULL DEFAULT 'buyer',
  media               JSONB   NOT NULL DEFAULT '[]',
  replies_disabled    BOOLEAN NOT NULL DEFAULT FALSE,
  privacy_visibility  TEXT    NOT NULL DEFAULT 'public',  -- 'public' | 'friends'
  privacy_reply_perm  TEXT    NOT NULL DEFAULT 'everyone',
  likes_count         INT     NOT NULL DEFAULT 0,
  views_count         INT     NOT NULL DEFAULT 0,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS stories_author_idx  ON stories (author_id);
CREATE INDEX IF NOT EXISTS stories_expires_idx ON stories (expires_at);

-- Per-story likes (toggle: insert removes if exists)
CREATE TABLE IF NOT EXISTS story_likes (
  story_id   UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (story_id, user_id)
);

-- Per-story views (upsert on viewed_at)
CREATE TABLE IF NOT EXISTS story_views (
  story_id  UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL,
  viewed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (story_id, user_id)
);
