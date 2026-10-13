-- 272: Profile song (Instagram profile music). One track per profile, picked
-- from the licensed preview provider; null when none. Served only while the
-- provider is configured from env AND the profileMusic feature flag is on.
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_song JSONB;

-- The flag row exists (off) so it shows up in the admin flag list.
INSERT INTO feature_flags (key, enabled, description)
VALUES ('profileMusic', FALSE, 'Profile song: needs PROFILE_MUSIC_PROVIDER + APPLE_MUSIC_DEVELOPER_TOKEN in env')
ON CONFLICT (key) DO NOTHING;
