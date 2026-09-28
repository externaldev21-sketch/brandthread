-- 104: Avatar video (moving profile picture), all account types.
--
-- A short (<=10s), always-muted, looping clip usable as the profile
-- picture, separate from the plain avatar photo (`profile_image_url`) and
-- from the profile cover video (`cover_video_url`). Stored as a
-- server-rendered, center-cropped square rendition + poster frame (object
-- storage paths served by /api/profile/avatar-media/*).
--
-- `avatar_video_updated_at` is informational (audit / future rate-limit
-- hook) — unlike the cover video, setting an avatar video has no
-- once-per-24h change limit.
-- Not a payout-path change.

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_video_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_poster_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_video_updated_at TIMESTAMPTZ;
