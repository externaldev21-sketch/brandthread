-- ─── Migration 111: post surface (Threads feed vs profile-only POST) ─────────
-- 'thread'  = public Threads feed (sellers only).
-- 'profile' = "POST": shows on the author's own profile grid, never in the feed.
-- Existing rows stay 'thread' (every pre-existing seller post was a Thread);
-- buyer posts were already profile-only, so they are backfilled to 'profile'.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS surface TEXT NOT NULL DEFAULT 'thread';

UPDATE posts
   SET surface = 'profile'
 WHERE surface = 'thread'
   AND user_id IN (SELECT clerk_id FROM users WHERE account_type = 'buyer');

CREATE INDEX IF NOT EXISTS posts_surface_created_published_idx
  ON posts (created_at DESC)
  WHERE post_status = 'published' AND surface = 'thread';

-- Ordered carousel slides for POST (photos and/or videos). Empty for legacy posts.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS slides JSONB NOT NULL DEFAULT '[]'::jsonb;
