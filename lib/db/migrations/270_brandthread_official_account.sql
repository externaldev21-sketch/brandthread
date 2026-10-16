-- ─── Migration 270: @brandthread official account + new-user Thread seeding ──
-- The official @brandthread creator account: a normal seller-style profile
-- (profile page, follow, posts grid) that platform admins publish Threads as
-- from the composer ("Post as @brandthread"). It has no password and no Clerk
-- identity — nobody can sign in as it. Idempotent: safe to run repeatedly.

-- ── Official account flag ──────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_official_account BOOLEAN NOT NULL DEFAULT false;

-- At most one official account can ever exist.
CREATE UNIQUE INDEX IF NOT EXISTS users_official_account_unique
  ON users (is_official_account)
  WHERE is_official_account = true;

-- ── Creator credit on reposted content ─────────────────────────────────────
-- "Video: @handle" credit line under the caption. Handle is stored without
-- the @ and resolved to a Brandthread profile at read time; name is optional
-- free text ("Bully Monday") for creators known by more than a handle.
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS credit_handle TEXT,
  ADD COLUMN IF NOT EXISTS credit_name   TEXT;

-- ── New-user seeding: which official Threads a viewer has actually seen ────
CREATE TABLE IF NOT EXISTS official_seed_impressions (
  user_id TEXT        NOT NULL,
  post_id UUID        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, post_id)
);

-- Threads a new user has viewed while inside the seeding window. Only rows
-- for users the server put in that window ever exist.
CREATE TABLE IF NOT EXISTS official_seed_progress (
  user_id        TEXT        PRIMARY KEY,
  threads_viewed INTEGER     NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Free @brandthread for the official account ─────────────────────────────
-- Migration 091 parked the handle on the Brandthread Agent (the AI friend in
-- Messages). The agent keeps its role and conversations under
-- @brandthread_agent; @brandthread becomes the official creator account.
UPDATE users
   SET username = 'brandthread_agent', updated_at = NOW()
 WHERE clerk_id = 'brandthread-agent'
   AND lower(username) = 'brandthread'
   AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.username) = 'brandthread_agent');

-- ── The official account itself ────────────────────────────────────────────
-- The bare ON CONFLICT DO NOTHING covers clerk_id, email and username, so a
-- rerun (or an environment where the handle is somehow held) never errors.
INSERT INTO users (
  clerk_id, email, name, role, display_name, brand_name, account_type,
  username, bio, onboarding_complete, verified, verification_status,
  is_official_account, active_standing, dm_privacy
)
VALUES (
  'brandthread-official',
  'official@brandthread.app',
  'Brandthread',
  'owner',
  'Brandthread',
  'Brandthread',
  'seller',
  'brandthread',
  'The official Brandthread account.',
  true,
  true,
  'verified',
  true,
  true,
  'requests'
)
ON CONFLICT DO NOTHING;
