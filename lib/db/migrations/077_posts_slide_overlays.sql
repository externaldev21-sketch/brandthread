-- Migration 077: add media_paths and slide_overlays columns to posts
-- media_paths: ordered array of object storage paths for slideshow slides
-- slide_overlays: per-slide overlay metadata keyed by slide index
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS media_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS slide_overlays jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Index for cleanup queries that need to find all object paths belonging to a post
CREATE INDEX IF NOT EXISTS posts_media_paths_idx ON posts USING GIN (media_paths);
