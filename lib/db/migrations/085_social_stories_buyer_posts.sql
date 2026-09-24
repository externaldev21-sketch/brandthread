-- 085: Social + Stories (follows, buyer posts, stories)
--
-- Every statement is idempotent so the runner can safely re-apply this file.
--   * stories: add a moderation_status column mirroring posts/post_comments so
--     a reported story can be held/removed without a hard delete, plus an
--     index on expires_at so the story cleanup job's sweep query stays cheap.
--   * story_likes / story_views: index the story_id side (already covered by
--     the composite PK's leading column, so nothing to add there) and add a
--     per-user lookup index on story_views for "stories I've seen" queries.

-- ── Story moderation ─────────────────────────────────────────────────────────
ALTER TABLE stories ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'visible';
ALTER TABLE stories ADD COLUMN IF NOT EXISTS moderation_reason TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stories_moderation_status_valid'
      AND conrelid = 'stories'::regclass
  ) THEN
    ALTER TABLE stories
      ADD CONSTRAINT stories_moderation_status_valid
      CHECK (moderation_status IN ('visible', 'held', 'removed'));
  END IF;
END
$$;

-- ── Story expiry cleanup ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS stories_expires_at_idx ON stories (expires_at);
CREATE INDEX IF NOT EXISTS stories_author_idx ON stories (author_id);

-- ── "Stories I've seen" lookups ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS story_views_user_idx ON story_views (user_id);
