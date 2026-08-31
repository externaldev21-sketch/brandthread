-- Seller post lifecycle: drafts, scheduled posts, and soft deletion.
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS post_status TEXT NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Existing posts were already visible, so treat them as published at creation
-- time while keeping the migration safe for partially-applied deployments.
UPDATE posts
SET published_at = created_at
WHERE post_status = 'published' AND published_at IS NULL;

CREATE INDEX IF NOT EXISTS posts_owner_lifecycle_idx
  ON posts (user_id, post_status, scheduled_at, created_at DESC);