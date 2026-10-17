-- 317: Account privacy choices from the Privacy screen, enforced server-side.
-- Only keys the person changed are stored; missing keys use the server
-- defaults (which match the behaviour before this column existed).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS privacy_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
