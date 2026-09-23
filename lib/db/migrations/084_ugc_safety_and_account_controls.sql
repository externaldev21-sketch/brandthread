-- 084: User-generated content safety and account controls (App Store 1.2 / 5.1.1(v))
--
-- Every statement is idempotent so the runner can safely re-apply this file.
--   * post_comments / post_comment_likes: server-side Thread comments with a
--     moderation state (visible | held | removed). Held comments are only
--     visible to their author until a moderator reviews them.
--   * posts.moderation_status: captions flagged by the abuse filter are held
--     out of every public feed until reviewed; moderators can remove posts.
--   * reports: richer moderation queue metadata (resolved owner, excerpt,
--     automatic-filter source, resolution audit trail).
--   * users: platform suspension and Terms/Guidelines acceptance.
--   * muted_words: per-user phrases hidden from that user's feeds and comments.

-- ── Thread comments ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_comments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id            UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id          TEXT NOT NULL,
  parent_id          UUID REFERENCES post_comments(id) ON DELETE CASCADE,
  body               TEXT NOT NULL,
  moderation_status  TEXT NOT NULL DEFAULT 'visible',
  moderation_reason  TEXT,
  moderated_at       TIMESTAMPTZ,
  moderated_by       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'post_comments_moderation_status_valid'
      AND conrelid = 'post_comments'::regclass
  ) THEN
    ALTER TABLE post_comments
      ADD CONSTRAINT post_comments_moderation_status_valid
      CHECK (moderation_status IN ('visible', 'held', 'removed'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS post_comments_post_created_idx ON post_comments (post_id, created_at);
CREATE INDEX IF NOT EXISTS post_comments_author_idx ON post_comments (author_id);
CREATE INDEX IF NOT EXISTS post_comments_parent_idx ON post_comments (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS post_comments_held_idx ON post_comments (created_at) WHERE moderation_status = 'held';

CREATE TABLE IF NOT EXISTS post_comment_likes (
  comment_id  UUID NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX IF NOT EXISTS post_comment_likes_user_idx ON post_comment_likes (user_id);

-- ── Post caption moderation ─────────────────────────────────────────────────
ALTER TABLE posts ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'visible';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS moderation_reason TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'posts_moderation_status_valid'
      AND conrelid = 'posts'::regclass
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_moderation_status_valid
      CHECK (moderation_status IN ('visible', 'held', 'removed'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS posts_moderation_held_idx ON posts (created_at) WHERE moderation_status <> 'visible';

-- ── Report queue metadata ───────────────────────────────────────────────────
ALTER TABLE reports ADD COLUMN IF NOT EXISTS target_owner_id   TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS content_excerpt   TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS source            TEXT NOT NULL DEFAULT 'user';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution_action TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution_note   TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_by       TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_at       TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS reports_status_created_idx ON reports (status, created_at);
CREATE INDEX IF NOT EXISTS reports_target_idx ON reports (target_type, target_id);
CREATE INDEX IF NOT EXISTS reports_reporter_target_idx ON reports (reporter_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS reports_target_owner_idx ON reports (target_owner_id) WHERE target_owner_id IS NOT NULL;

-- ── Account standing + legal acceptance ─────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at      TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version     TEXT;
CREATE INDEX IF NOT EXISTS users_suspended_idx ON users (suspended_at) WHERE suspended_at IS NOT NULL;

-- ── Muted words ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS muted_words (
  user_id     TEXT NOT NULL,
  phrase      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, phrase)
);
