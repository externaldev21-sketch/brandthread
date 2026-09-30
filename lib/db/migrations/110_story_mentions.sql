-- ─── Migration 110: Story @mentions + story reshares ─────────────────────────
-- story_mentions: one row per (story, tagged person) with the sticker's
-- placement and the tagged person's handling state (reshared / dismissed).
-- stories.original_story_id / original_author_id: a reshare ("Add to your
-- story") points back at the story that tagged the resharer. Deliberately NOT
-- a foreign key — when the original expires or is deleted the reshare keeps
-- its credit and shows "Story unavailable".

ALTER TABLE stories ADD COLUMN IF NOT EXISTS original_story_id UUID;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS original_author_id TEXT;

CREATE TABLE IF NOT EXISTS story_mentions (
  story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  mentioned_user_id TEXT NOT NULL,
  tagger_id TEXT NOT NULL,
  sticker JSONB NOT NULL DEFAULT '{}'::jsonb,
  handled_at TIMESTAMP,
  handled_action TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (story_id, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS story_mentions_mentioned_idx
  ON story_mentions (mentioned_user_id, created_at);

-- One "mentioned you in their story" / "shared your story" Activity row per
-- (recipient, story), even if the tag is retried.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_feed_story_mention_unique
  ON notifications_feed (user_id, type, target_id)
  WHERE type IN ('story_mention', 'story_reshare') AND target_id IS NOT NULL;
