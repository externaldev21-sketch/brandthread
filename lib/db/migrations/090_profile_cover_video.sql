-- 090: Profile cover video (buyer + seller profiles).
--
-- A short (≤30s), always-muted, looping clip shown in the profile hero,
-- separate from the avatar. Stored as a server-compressed rendition + poster
-- frame (object-storage paths served by /api/profile/cover-media/*).
--
-- cover_video_updated_at: server-enforced once-per-24h change limit — both
--   setting and removing a cover count as a change.
-- cover_video_moderation_status: mirrors posts.moderation_status ('visible'
--   by default; a moderator can hide it).
-- cover_coachmark_seen_at: the first-visit "add a cover video" coach mark is
--   shown exactly once per account (server-side so it survives reinstall and
--   multiple devices).
-- Not a payout-path change.

ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_video_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_poster_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_video_updated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_video_moderation_status TEXT NOT NULL DEFAULT 'visible';
ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_coachmark_seen_at TIMESTAMPTZ;
