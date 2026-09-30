-- ─── Migration 115: pinned comments ──────────────────────────────────────────
-- The post owner can pin one top-level comment per post. Pinning another
-- replaces it (enforced by the partial unique index).
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS post_comments_one_pinned_per_post
  ON post_comments (post_id)
  WHERE pinned_at IS NOT NULL;
