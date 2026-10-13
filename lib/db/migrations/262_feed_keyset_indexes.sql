-- 262: Feed / profile keyset indexes (speed polish #14).
--
-- Every public feed read filters with publicPostCondition():
--   post_status = 'published' OR (post_status = 'scheduled' AND scheduled_at <= now())
-- The older partial indexes (WHERE post_status = 'published', migration 088)
-- can't be proven to cover that OR, so Postgres fell back to a parallel seq
-- scan + top-N sort for the platform-wide feed and a per-author loop for the
-- Following feed. Measured on 400k posts / 20k authors:
--   platform feed page:   95 ms  ->  0.06 ms (index scan, no sort)
--   following feed page:  28 ms  ->  5 ms
--   deep keyset page:     index scan, 0.3 ms
-- Both indexes match the (created_at DESC, id DESC) keyset order used by the
-- cursor pagination in routes/posts.ts and routes/feed.ts.
CREATE INDEX IF NOT EXISTS posts_feed_keyset_idx
  ON posts (created_at DESC, id DESC)
  WHERE moderation_status = 'visible' AND post_status IN ('published', 'scheduled');

CREATE INDEX IF NOT EXISTS posts_user_feed_keyset_idx
  ON posts (user_id, created_at DESC, id DESC)
  WHERE moderation_status = 'visible' AND post_status IN ('published', 'scheduled');
