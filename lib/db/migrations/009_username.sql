-- 009: Add unique username (@handle) column to users
-- username is nullable so existing rows are unaffected; new users set it during onboarding or edit-profile.
-- The partial unique index enforces platform-wide uniqueness only for non-null values.

ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_key
  ON users (username)
  WHERE username IS NOT NULL;
