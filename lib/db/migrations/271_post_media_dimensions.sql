-- ─── Migration 271: pixel dimensions for post media ─────────────────────────
-- Clients size every feed / profile / grid media item from these on the very
-- first frame, so nothing renders at a guessed size and snaps when the image
-- or video loads. Additive and idempotent.
--   media_width/height      primary media (the video, or the first slide)
--   thumbnail_width/height  its poster / grid thumbnail
--   media_dimensions        [{width,height}|null] per media_urls entry
--   slides[].width/height   per POST-carousel slide (inside the slides jsonb)
-- NULL = not measured yet; the API's media-dimensions backfill job fills
-- existing posts (including the @brandthread seed content) after deploy.
-- 0 = the media could not be measured (clients use their fallback ratio).

ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_width INTEGER;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_height INTEGER;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS thumbnail_width INTEGER;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS thumbnail_height INTEGER;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_dimensions JSONB NOT NULL DEFAULT '[]'::jsonb;

-- The backfill scans for unmeasured posts; keep that cheap.
CREATE INDEX IF NOT EXISTS posts_media_dims_pending_idx
  ON posts (created_at DESC)
  WHERE media_width IS NULL;
