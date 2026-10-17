-- 271: Server-side pronouns and Style badge on the public profile.
-- Personal Details and Edit Profile previously kept these on the device only,
-- so other people never saw them. Both are nullable; null = never set.
--   pronouns    free text, validated to <= 30 chars by PATCH /api/auth/profile
--   style_badge { "label": text <= 24, "emoji": text <= 8, "enabled": bool }
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pronouns TEXT;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS style_badge JSONB;
