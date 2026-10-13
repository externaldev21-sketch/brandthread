-- 261: Profile banner (TikTok-style) — extends the profile cover (090) so the
-- banner can be a GIF as well as a looping muted video. Buyers and sellers
-- both live in `users`, so one pair of columns covers both profile types.
--   cover_media_type: 'video' | 'gif' (NULL on rows written before this
--                     migration — those are read as 'video' when
--                     cover_video_url is set).
--   cover_image_url:  public /api/profile/cover-media URL of a GIF banner's
--                     original file (the fallback; cover_video_url holds the
--                     looping MP4 it was converted to).
ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_media_type TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
