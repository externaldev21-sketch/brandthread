-- Scale phase 2: indexes found by load testing (docs/scale/SCALE_PLAN.md).
-- Idempotent. Plain CREATE INDEX (the runner wraps each file in a transaction,
-- so CONCURRENTLY is not available): each takes a brief write lock on its table.

-- Public search matches video captions with ILIKE / trigram similarity.
CREATE INDEX IF NOT EXISTS posts_caption_trgm_video_idx
  ON posts USING gin (caption gin_trgm_ops) WHERE media_type = 'video';

-- GET /api/posts/media/<path> finds the owning post by the path after
-- /api/posts/media/. It used `LIKE '%/api/posts/media/<path>'` (sequential scan
-- of posts on every video view). These expression indexes make it an equality
-- lookup. The regex literal must stay identical to the one in routes/post-video.ts.
CREATE INDEX IF NOT EXISTS posts_media_path_expr_idx
  ON posts ((substring(media_url from '/api/posts/media/(.+)$')));
CREATE INDEX IF NOT EXISTS posts_thumb_path_expr_idx
  ON posts ((substring(thumbnail_url from '/api/posts/media/(.+)$')));
