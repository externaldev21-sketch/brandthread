-- 270: Adaptive streaming (HLS) copy of video posts.
-- Written only when the Mux integration is configured (MUX_TOKEN_ID /
-- MUX_TOKEN_SECRET / MUX_WEBHOOK_SECRET). All columns are nullable; a post
-- without them keeps playing its original MP4.
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS video_hls_url TEXT,
  ADD COLUMN IF NOT EXISTS video_mux_asset_id TEXT,
  ADD COLUMN IF NOT EXISTS video_hls_status TEXT;

CREATE INDEX IF NOT EXISTS posts_video_mux_asset_idx
  ON posts (video_mux_asset_id)
  WHERE video_mux_asset_id IS NOT NULL;
