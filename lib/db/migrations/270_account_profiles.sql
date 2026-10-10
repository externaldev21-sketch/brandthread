-- ─── Migration 270: one login = at most one buyer + one seller profile ──────
-- A login (the Clerk user someone signs in with: email/password, Apple or
-- Google) can own a second profile of the other role. The second profile is
-- its own Clerk user and its own `users` row, so followers, posts, store,
-- payouts, DMs and notifications stay fully separate; this table only
-- records which login owns which profile.
--
-- Never two buyers or two sellers on one login: unique (login, role) among
-- live rows. A deleted profile keeps its row (deleted_at set) so per-person
-- limits (one free trial, one onboarding AI sample) still see it, and the
-- role can be created again.
CREATE TABLE IF NOT EXISTS account_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  login_clerk_id    TEXT NOT NULL,
  profile_clerk_id  TEXT NOT NULL,
  role              TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS account_profiles_profile_unique
  ON account_profiles (profile_clerk_id);

CREATE UNIQUE INDEX IF NOT EXISTS account_profiles_login_role_unique
  ON account_profiles (login_clerk_id, role)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS account_profiles_login_idx
  ON account_profiles (login_clerk_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_profiles_role_check'
  ) THEN
    ALTER TABLE account_profiles
      ADD CONSTRAINT account_profiles_role_check CHECK (role IN ('buyer', 'seller'));
  END IF;
END $$;
